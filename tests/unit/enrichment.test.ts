import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type DbHandle } from "@/server/db/client";
import { bootstrap } from "@/server/db/bootstrap";
import { companies, contacts, evidence } from "@/server/db/schema";
import { createCandidate, editCompany } from "@/server/repo/companies";
import { getDefaultRule, saveRule } from "@/server/repo/rules";
import { applyFindings } from "@/server/enrichment/apply";
import { enrichCompany } from "@/server/enrichment/pipeline";
import { cleanPersonName, emailBelongsTo, personKey, splitCityStateZip } from "@/server/enrichment/people";
import { buildDomainQuery, buildHvacDiscoveryQuery, parseOsm } from "@/server/enrichment/osm";
import {
  REGISTRY_DATASETS,
  findingsFromRegistryRow,
  locationAgrees,
  matchRegistryRows,
  openDataRegistrySource,
} from "@/server/enrichment/sources/registries";
import { buildPage, findingsFromPages, waybackSource, websiteDeepSource } from "@/server/enrichment/sources/web";
import { osmSource } from "@/server/enrichment/sources/osm";
import { parseRdapResponse, rdapSource } from "@/server/enrichment/sources/rdap";
import { extractSocialFootprint, socialProfileSource } from "@/server/enrichment/sources/social";
import type { EnrichmentContext, EnrichmentSource, EnrichmentTarget } from "@/server/enrichment/types";
import { classifyTitle } from "@/server/domain/contact";

const target = (over: Partial<EnrichmentTarget> = {}): EnrichmentTarget => ({
  companyId: "c1",
  name: "Cool Air LLC",
  website: "https://coolair.com",
  domain: "coolair.com",
  address: null,
  city: "Dallas",
  state: "TX",
  zip: null,
  phone: null,
  missing: [],
  hasOwner: false,
  hasEmail: false,
  ...over,
});

const fakeCtx = (pages: Record<string, string> = {}, json: Record<string, unknown> = {}): EnrichmentContext => ({
  async fetchText(url) {
    const html = pages[url];
    return html ? { ok: true, status: 200, url, text: html } : { ok: false, status: 404, url, text: "" };
  },
  async fetchJson(url) {
    const k = Object.keys(json).find((x) => url.startsWith(x));
    return k ? (json[k] as never) : null;
  },
});

const ABOUT = `<html><body><div class="team"><h3>Jane Doe</h3><p>Owner</p><a href="mailto:jane@coolair.com">Email</a></div>
<p>Questions? <a href="mailto:info@coolair.com">info@coolair.com</a> or mail evil@elsewhere.com</p></body></html>`;
const CONTACT = `<html><head><script type="application/ld+json">{"@type":"LocalBusiness","name":"Cool Air","telephone":"(214) 710-4422","address":{"streetAddress":"1 Main St","addressLocality":"Dallas","addressRegion":"TX","postalCode":"75201"}}</script></head><body>Contact us</body></html>`;

const TDLR_ROW = { business_name: "COOL AIR LLC", owner_name: "DOE, JANE", business_address_line1: "1 MAIN ST", business_city_state_zip: "DALLAS, TX 75201" };
const TDLR = REGISTRY_DATASETS.find((d) => d.id === "tx_tdlr_all_licenses")!;

describe("people helpers", () => {
  it("cleans registry names and rejects entities / junk", () => {
    expect(cleanPersonName("DOE, JANE A")).toBe("Jane A Doe");
    expect(cleanPersonName("MCDONALD, ROBERT")).toBe("Robert McDonald");
    expect(cleanPersonName("ACME HOLDINGS LLC")).toBeNull();
    expect(cleanPersonName("J D")).toBeNull();
    expect(cleanPersonName("Cool Air Services")).toBeNull();
  });
  it("personKey ignores middle names and suffixes", () => {
    expect(personKey("Jane A. Doe Jr")).toBe(personKey("jane doe"));
    expect(personKey("Madonna")).toBeNull();
  });
  it("only conventional email patterns belong to a person", () => {
    expect(emailBelongsTo("jane@coolair.com", "Jane Doe")).toBe(true);
    expect(emailBelongsTo("jdoe@coolair.com", "Jane Doe")).toBe(true);
    expect(emailBelongsTo("info@coolair.com", "Jane Doe")).toBe(false);
    expect(emailBelongsTo("bob@coolair.com", "Jane Doe")).toBe(false);
  });
  it("splits combined city/state/zip", () => {
    expect(splitCityStateZip("DALLAS, TX 75201")).toEqual({ city: "Dallas", state: "TX", zip: "75201" });
    expect(splitCityStateZip("garbage")).toBeNull();
  });
  it("chairman / proprietor / managing member are principal roles", () => {
    expect(classifyTitle("Chairman")).toBe("president");
    expect(classifyTitle("Proprietor")).toBe("owner");
    expect(classifyTitle("Managing Member")).toBe("owner");
    expect(classifyTitle("Vice President")).toBe("other");
  });
});

describe("OpenStreetMap helpers", () => {
  it("builds bounded queries and escapes the domain", () => {
    expect(buildDomainQuery("www.cool-air.com", "tx")).toContain('"website"~"cool-air\\\\.com"');
    expect(buildDomainQuery("coolair.com", "TX")).toContain("US-TX");
    const q = buildHvacDiscoveryQuery({ states: ["TX", "FL"], cities: ["Dallas"], limit: 5000 });
    expect(q).toContain("US-FL");
    expect(q).toContain("out tags center 500;");
  });
  it("parses only named elements", () => {
    const r = parseOsm({ elements: [{ type: "way", id: 1, tags: { name: "A", "contact:phone": "1", "contact:email": "X@Y.com" } }, { type: "node", id: 2, tags: {} }] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ ref: "way/1", phone: "1", email: "x@y.com" });
  });
});

describe("registry matching: precision over recall", () => {
  it("requires an exact legal-name match after removing LLC / INC", () => {
    const rows = [TDLR_ROW, { ...TDLR_ROW, business_name: "COOL AIR HEATING LLC" }];
    expect(matchRegistryRows(rows, TDLR, { name: "Cool Air, Inc.", city: "Dallas", zip: null })).toHaveLength(1);
  });
  it("rejects a same-name company in a different city / ZIP", () => {
    expect(matchRegistryRows([TDLR_ROW], TDLR, { name: "Cool Air", city: "Houston", zip: null })).toEqual([]);
    expect(matchRegistryRows([TDLR_ROW], TDLR, { name: "Cool Air", city: null, zip: "77001" })).toEqual([]);
  });
  it("accepts a lone exact match when location is unknown, never an ambiguous one", () => {
    const noLoc = { business_name: "COOL AIR LLC", owner_name: "DOE, JANE" };
    expect(matchRegistryRows([noLoc], TDLR, { name: "Cool Air", city: null, zip: null })).toHaveLength(1);
    expect(matchRegistryRows([noLoc, { ...noLoc, owner_name: "ROE, RICK" }], TDLR, { name: "Cool Air", city: null, zip: null })).toEqual([]);
  });
  it("locationAgrees is tri-valued", () => {
    expect(locationAgrees({ street: null, city: "Dallas", state: null, zip: null }, { city: "dallas", zip: null })).toBe(true);
    expect(locationAgrees({ street: null, city: null, state: null, zip: null }, { city: "dallas", zip: null })).toBeNull();
  });
  it("registry source queries only datasets covering the company's state", async () => {
    const calls: string[] = [];
    const ctx: EnrichmentContext = { fetchText: async () => null, fetchJson: async (u) => (calls.push(u), [TDLR_ROW] as never) };
    const f = await openDataRegistrySource.run(target(), ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("data.texas.gov/resource/7358-krk7");
    expect(f.find((x) => x.kind === "contact")).toMatchObject({ name: "Jane Doe", title: "Owner (TDLR licensee)", verified: true, sourceType: "government" });
    expect(openDataRegistrySource.appliesTo(target({ state: "ZZ" }))).toBe(false);
  });
});

describe("website sources", () => {
  it("extracts people, links their own email, keeps own-domain emails only", () => {
    const pages = [buildPage("https://coolair.com/about", ABOUT), buildPage("https://coolair.com/contact", CONTACT)];
    const f = findingsFromPages(pages, target(), { sourceLabel: "Company website", verified: true, confidenceFactor: 1 });
    const person = f.find((x) => x.kind === "contact" && x.name === "Jane Doe");
    expect(person).toMatchObject({ kind: "contact", email: "jane@coolair.com", verified: true });
    const emails = f.filter((x) => x.kind === "contact").map((x) => (x as { email: string | null }).email);
    expect(emails).toContain("info@coolair.com");
    expect(emails).not.toContain("evil@elsewhere.com");
    expect(f.filter((x) => x.kind === "company_field").map((x) => (x as { field: string }).field)).toEqual(expect.arrayContaining(["phone", "address", "zip"]));
  });
  it("archived pages never produce verified people or company fields", () => {
    const f = findingsFromPages([buildPage("https://web.archive.org/web/2020/https://coolair.com/about", ABOUT)], target(), {
      sourceLabel: "Internet Archive copy",
      verified: false,
      confidenceFactor: 0.75,
    });
    expect(f.some((x) => x.kind === "company_field")).toBe(false);
    expect(f.filter((x) => x.kind === "contact").every((x) => (x as { verified: boolean }).verified === false)).toBe(true);
  });
  it("website_deep and wayback fetch targeted pages through the injected context", async () => {
    const f = await websiteDeepSource.run(target(), fakeCtx({ "https://coolair.com/about": ABOUT, "https://coolair.com/contact": CONTACT }));
    expect(f.length).toBeGreaterThan(0);
    const wb = await waybackSource.run(
      target(),
      fakeCtx(
        { "https://web.archive.org/web/20200101id_/https://coolair.com/about": ABOUT },
        { "https://archive.org/wayback/available?url=coolair.com%2Fabout": { archived_snapshots: { closest: { available: true, url: "http://web.archive.org/web/20200101/https://coolair.com/about", timestamp: "20200101" } } } },
      ),
    );
    expect(wb.some((x) => x.kind === "contact" && x.name === "Jane Doe" && !x.verified)).toBe(true);
    expect(wb.find((x) => x.kind === "contact" && x.name === "Jane Doe")).toMatchObject({ evidenceText: expect.stringContaining("archived 2020-01-01") });
  });
  it("osm source matches ONLY on identical website domain", async () => {
    const json = (website: string) => ({ elements: [{ type: "node", id: 7, tags: { name: "Cool Air", website, phone: "(214) 710-4422", "addr:postcode": "75201" } }] });
    const hit = await osmSource.run(target(), fakeCtx({}, { "https://overpass-api.de/api/interpreter": json("https://www.coolair.com/") }));
    expect(hit.some((x) => x.kind === "company_field" && x.field === "phone")).toBe(true);
    const miss = await osmSource.run(target(), fakeCtx({}, { "https://overpass-api.de/api/interpreter": json("https://othercool.com") }));
    expect(miss).toEqual([]);
  });
});

describe("enrichment pipeline (real DB, offline network)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createDb("memory://");
    await bootstrap(handle.db);
    // A permissive rule so the tests isolate DATA completeness from service research.
    const rule = await getDefaultRule(handle.db);
    const cfg = rule.config;
    await saveRule(
      handle.db,
      rule.id,
      {
        name: rule.name,
        config: {
          ...cfg,
          businessType: "both",
          services: { requiredAnyOf: [], preferred: [] },
          size: { minEmployees: null, maxEmployees: null, allowUnknown: true },
          scoring: { ...cfg.scoring, minScore: 0 },
        },
      },
      "test",
    );
  });
  afterAll(async () => {
    await handle.close();
  });

  const newCompany = async (name: string, extra: Record<string, string> = {}) => {
    const res = await createCandidate(
      handle.db,
      { name, website: `https://${name.toLowerCase().replace(/[^a-z]/g, "")}.com`, city: "Dallas", state: "TX", ...extra },
      { actor: "test", force: true },
    );
    if (res.kind !== "created") throw new Error("not created: " + res.kind);
    return res.id;
  };

  it("fills every missing field from the website, stores evidence, and stops early", async () => {
    const id = await newCompany("Pipeline Air");
    const ctx = fakeCtx({
      "https://pipelineair.com/about": ABOUT.replaceAll("coolair", "pipelineair"),
      "https://pipelineair.com/contact": CONTACT,
    });
    const r = await enrichCompany(handle.db, id, { ctx });
    expect(r.tierBefore).toBe("ALMOST");
    expect(r.tierAfter).toBe("QUALIFIED");
    expect(r.missingAfter).toEqual([]);
    expect(r.note).toContain("stopped early");
    expect(r.sources.find((s) => s.id === "open_data_registries")).toBeUndefined();

    const [c] = await handle.db.select().from(companies).where(eq(companies.id, id));
    expect(c).toMatchObject({ phoneDisplay: "(214) 710-4422", address: "1 Main St", zip: "75201" });
    const people = await handle.db.select().from(contacts).where(eq(contacts.companyId, id));
    const jane = people.find((p) => p.name === "Jane Doe")!;
    expect(jane).toMatchObject({ verified: true, provenance: "PUBLICLY_VERIFIED", roleClass: "owner", email: "jane@pipelineair.com" });
    expect(jane.sourceUrl).toContain("pipelineair.com/about");
    const ev = await handle.db.select().from(evidence).where(eq(evidence.companyId, id));
    expect(ev.length).toBeGreaterThan(0);
    const written = ev.filter((e) => ["contact_name", "contact_email", "address", "zip", "company_phone"].includes(e.field));
    expect(written.length).toBeGreaterThanOrEqual(5);
    expect(written.every((e) => !!e.sourceUrl && e.provenance === "PUBLICLY_VERIFIED")).toBe(true);
  });

  it("running again is idempotent (no duplicate contacts)", async () => {
    const id = await newCompany("Repeat Air");
    const ctx = fakeCtx({ "https://repeatair.com/about": ABOUT.replaceAll("coolair", "repeatair") });
    await enrichCompany(handle.db, id, { ctx });
    const before = (await handle.db.select().from(contacts).where(eq(contacts.companyId, id))).length;
    await enrichCompany(handle.db, id, { ctx });
    expect((await handle.db.select().from(contacts).where(eq(contacts.companyId, id))).length).toBe(before);
  });

  it("an unverified archived person becomes verified when an official registry confirms the same person", async () => {
    const id = await newCompany("Cool Air");
    const archived: EnrichmentSource = {
      meta: { id: "stub_archive", name: "Stub archive", description: "", provides: [] },
      appliesTo: () => true,
      run: async () => [
        { kind: "contact", name: "Jane Doe", title: "Owner", email: null, phone: null, confidence: 0.7, verified: false, sourceUrl: "https://web.archive.org/web/2020/x", sourceType: "website", evidenceText: "archived" },
      ],
    };
    const ctx = fakeCtx({}, { "https://data.texas.gov/resource/7358-krk7.json": [TDLR_ROW] });

    await enrichCompany(handle.db, id, { ctx, sources: [archived] });
    let jane = (await handle.db.select().from(contacts).where(eq(contacts.companyId, id))).find((p) => p.name === "Jane Doe")!;
    expect(jane.verified).toBe(false);

    const r = await enrichCompany(handle.db, id, { ctx, sources: [openDataRegistrySource] });
    jane = (await handle.db.select().from(contacts).where(eq(contacts.companyId, id))).find((p) => p.name === "Jane Doe")!;
    expect(jane.verified).toBe(true);
    expect(r.sources[0]!.applied.join(" ")).toContain("verified by a second source");
    expect(r.missingAfter).not.toContain("CEO / Owner name");
  });

  it("never overwrites a field a human locked", async () => {
    const id = await newCompany("Locked Air", { address: "9 Old Rd" });
    await editCompany(handle.db, id, { address: "5 Human St" }, "tester");
    const { applied } = await applyFindings(
      handle.db,
      id,
      [{ kind: "company_field", field: "address", value: "1 Main St", confidence: 0.9, sourceUrl: "https://x.com", sourceType: "website", evidenceText: "x" }],
      "test",
    );
    expect(applied).toEqual([]);
    const [c] = await handle.db.select().from(companies).where(eq(companies.id, id));
    expect(c!.address).toBe("5 Human St");
  });

  it("does not spend requests on leads the rules already rejected", async () => {
    const rule = await getDefaultRule(handle.db);
    const original = rule.config;
    await saveRule(handle.db, rule.id, { name: rule.name, config: { ...original, geography: { ...original.geography, states: ["FL"] } } }, "test");
    try {
      const id = await newCompany("Wrong State Air");
      let calls = 0;
      const ctx: EnrichmentContext = { fetchText: async () => (calls++, null), fetchJson: async () => (calls++, null) };
      const r = await enrichCompany(handle.db, id, { ctx });
      expect(r.tierBefore).toBe("REJECTED");
      expect(r.note).toContain("Rejected");
      expect(calls).toBe(0);
    } finally {
      await saveRule(handle.db, rule.id, { name: rule.name, config: original }, "test");
    }
  });

  it("a failing source is reported but does not stop the others", async () => {
    const id = await newCompany("Resilient Air");
    const broken: EnrichmentSource = {
      meta: { id: "broken", name: "Broken", description: "", provides: [] },
      appliesTo: () => true,
      run: async () => {
        throw new Error("boom");
      },
    };
    const r = await enrichCompany(handle.db, id, {
      ctx: fakeCtx({ "https://resilientair.com/about": ABOUT.replaceAll("coolair", "resilientair"), "https://resilientair.com/contact": CONTACT }),
      sources: [broken, websiteDeepSource],
    });
    expect(r.sources[0]).toMatchObject({ id: "broken", status: "error", error: "boom" });
    expect(r.tierAfter).toBe("QUALIFIED");
  });

  describe("ICANN RDAP domain registry", () => {
    it("extracts public administrative contact, phone, and address", () => {
      const rdapPayload = {
        ldhName: "coolair.com",
        entities: [
          {
            roles: ["administrative"],
            vcardArray: [
              "vcard",
              [
                ["version", {}, "text", "4.0"],
                ["fn", {}, "text", "Robert Miller"],
                ["tel", { type: "voice" }, "uri", "tel:+1-214-555-0199"],
                ["email", {}, "text", "robert@coolair.com"],
                ["adr", {}, "text", ["", "", "100 Elm St", "Dallas", "TX", "75201", "USA"]],
              ],
            ],
          },
        ],
      };

      const t = target({ domain: "coolair.com", missing: ["CEO / Owner name", "Street address", "Company phone"] });
      const findings = parseRdapResponse(rdapPayload, t);

      const contact = findings.find((f) => f.kind === "contact");
      expect(contact).toBeDefined();
      expect(contact).toMatchObject({
        kind: "contact",
        name: "Robert Miller",
        title: "Administrative Contact (RDAP)",
        email: "robert@coolair.com",
        phone: "(214) 555-0199",
        verified: false,
      });

      const addr = findings.find((f) => f.kind === "company_field" && f.field === "address");
      expect(addr).toBeDefined();
      expect(addr).toMatchObject({ field: "address", value: "100 Elm St" });

      const phone = findings.find((f) => f.kind === "company_field" && f.field === "phone");
      expect(phone).toBeDefined();
      expect(phone).toMatchObject({ field: "phone", value: "(214) 555-0199" });
    });

    it("safely ignores privacy-protected / redacted RDAP entities", () => {
      const privacyPayload = {
        ldhName: "maskedhvac.com",
        entities: [
          {
            roles: ["registrant"],
            vcardArray: [
              "vcard",
              [
                ["version", {}, "text", "4.0"],
                ["fn", {}, "text", "Domains By Proxy, LLC"],
                ["org", {}, "text", "Domains By Proxy, LLC"],
                ["email", {}, "text", "maskedhvac.com@domainsbyproxy.com"],
              ],
            ],
          },
          {
            roles: ["administrative"],
            vcardArray: [
              "vcard",
              [
                ["version", {}, "text", "4.0"],
                ["fn", {}, "text", "Registration Private / WhoisGuard Protected"],
              ],
            ],
          },
        ],
      };

      const t = target({ domain: "maskedhvac.com", missing: ["CEO / Owner name"] });
      const findings = parseRdapResponse(privacyPayload, t);
      expect(findings).toEqual([]);
    });
  });

  describe("Social & professional footprint extractor", () => {
    it("extracts owner name directly from personal LinkedIn profile links on company pages", () => {
      const html = `
        <html>
          <body>
            <div class="team-card">
              <h3>David Miller</h3>
              <p>Founder & Master Technician</p>
              <a href="https://www.linkedin.com/in/david-miller-hvac">Connect on LinkedIn</a>
            </div>
            <footer>
              <a href="https://www.bbb.org/us/tx/dallas/profile/air-conditioning/cool-air-llc-0875-12345">BBB Accredited</a>
              <a href="https://www.yelp.com/biz/cool-air-dallas">Yelp Reviews</a>
            </footer>
          </body>
        </html>
      `;

      const t = target({ website: "https://coolair.com" });
      const findings = extractSocialFootprint(html, "https://coolair.com/about", t);

      const liContact = findings.find((f) => f.kind === "contact" && f.sourceUrl.includes("linkedin.com"));
      expect(liContact).toBeDefined();
      expect(liContact).toMatchObject({
        kind: "contact",
        name: "David Miller",
        title: "Owner / Executive (LinkedIn)",
        verified: true,
        sourceUrl: "https://www.linkedin.com/in/david-miller-hvac",
      });
    });

    it("extracts clean person name from slug when anchor text is an icon or generic label", () => {
      const html = `
        <html>
          <body>
            <a href="https://linkedin.com/in/sarah-connor-987654321"><i class="fa fa-linkedin"></i></a>
          </body>
        </html>
      `;

      const t = target({ website: "https://coolair.com" });
      const findings = extractSocialFootprint(html, "https://coolair.com", t);
      const li = findings.find((f) => f.kind === "contact");
      expect(li).toBeDefined();
      expect(li?.name).toBe("Sarah Connor");
    });
  });

  describe("Expanded state registries", () => {
    it("matches Colorado registry with composite agent first and last name", () => {
      const coDataset = REGISTRY_DATASETS.find((d) => d.id === "co_business_entities")!;
      expect(coDataset).toBeDefined();
      expect(coDataset.states).toContain("CO");

      const row = {
        entityname: "SUMMIT PEAK HVAC LLC",
        agentfirstname: "CARL",
        agentlastname: "PETERSON",
        principaladdress1: "500 MOUNTAIN WAY",
        principalcity: "DENVER",
        principalstate: "CO",
        principalzipcode: "80202",
      };

      const t = { name: "Summit Peak HVAC LLC", phone: null, address: null, city: null, state: "CO", zip: null };
      const findings = findingsFromRegistryRow(row, coDataset, t);

      const contact = findings.find((f) => f.kind === "contact");
      expect(contact).toBeDefined();
      expect(contact).toMatchObject({
        name: "Carl Peterson",
        title: "Registered Agent",
        verified: true,
        sourceType: "government",
      });

      const addr = findings.find((f) => f.kind === "company_field" && f.field === "address");
      expect(addr).toMatchObject({ field: "address", value: "500 Mountain Way" });
    });

    it("matches Chicago IL and Maryland MD datasets correctly", () => {
      const il = REGISTRY_DATASETS.find((d) => d.id === "il_chicago_business_licenses");
      const md = REGISTRY_DATASETS.find((d) => d.id === "md_business_licenses");
      expect(il?.states).toContain("IL");
      expect(md?.states).toContain("MD");
    });
  });
});
