import { describe, expect, it } from "vitest";
import { checkCompleteness, resolveCompleteness } from "@/server/domain/completeness";
import { qualifyLead, type QualifyCompany } from "@/server/domain/qualification";
import { defaultHvacRuleConfig, ruleConfigSchema } from "@/server/domain/rules";
import type { ContactInput } from "@/server/domain/contact";
import type { FactEntry, FactMap } from "@/server/domain/facts";

const fact = (value: string): FactEntry => ({
  value,
  confidence: 0.9,
  provenance: "PUBLICLY_VERIFIED",
  evidenceId: null,
  updatedAt: new Date().toISOString(),
});

const ceo = (over: Partial<ContactInput> = {}): ContactInput => ({
  name: "Jane Doe",
  title: "CEO",
  roleClass: "president",
  email: "jane@coolair.com",
  emailType: "PUBLIC_BUSINESS",
  phone: "(214) 555-0101",
  phoneType: "PUBLISHED_DIRECT",
  verified: true,
  ...over,
});

const facts: FactMap = {
  hvac: fact("YES"),
  residential: fact("YES"),
  replacement: fact("YES"),
  installation: fact("YES"),
  website_alive: fact("YES"),
  multiple_technicians: fact("YES"),
  financing: fact("YES"),
  multiple_service_areas: fact("YES"),
  hiring: fact("YES"),
  strong_presence: fact("YES"),
  established_business: fact("YES"),
};

const company = (over: Partial<QualifyCompany> = {}): QualifyCompany => ({
  name: "Cool Air",
  website: "https://coolair.com",
  phone: "(214) 555-0100",
  address: "1 Main St",
  city: "Dallas",
  state: "TX",
  zip: "75001",
  facts,
  contacts: [ceo()],
  contactResearchDone: true,
  ...over,
});

const rule = defaultHvacRuleConfig();

describe("completeness", () => {
  it("old rules without a completeness block fall back to defaults", () => {
    const parsed = ruleConfigSchema.parse({ ...rule, completeness: undefined });
    expect(parsed.completeness.requiredFields).toContain("owner_name");
    expect(resolveCompleteness(undefined).requireVerifiedOwner).toBe(true);
  });

  it("reports exactly which required fields are missing", () => {
    const r = checkCompleteness(
      { website: "https://x.com", phone: null, address: null, city: "Dallas", state: "TX", zip: null, employees: null, contacts: [] },
      { requiredFields: ["website", "company_phone", "owner_name", "city"], requireVerifiedOwner: true },
    );
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(["company_phone", "owner_name"]);
    expect(r.pct).toBe(50);
  });

  it("an unverified owner does not count when verification is required", () => {
    const base = { website: "w", phone: "2145550100", address: "a", city: "c", state: "s", zip: "z", employees: null };
    const cfg = { requiredFields: ["owner_name" as const], requireVerifiedOwner: true };
    expect(checkCompleteness({ ...base, contacts: [ceo({ verified: false })] }, cfg).complete).toBe(false);
    expect(checkCompleteness({ ...base, contacts: [ceo({ verified: false })] }, { ...cfg, requireVerifiedOwner: false }).complete).toBe(true);
  });

  it("a manager is not accepted as CEO / owner", () => {
    const r = checkCompleteness(
      { website: "w", phone: null, address: null, city: null, state: null, zip: null, employees: null, contacts: [ceo({ roleClass: "general_manager", title: "GM" })] },
      { requiredFields: ["owner_name"], requireVerifiedOwner: true },
    );
    expect(r.missing).toEqual(["owner_name"]);
  });
});

describe("qualifyLead", () => {
  it("a complete lead that passes every rule is QUALIFIED", () => {
    const q = qualifyLead(company(), rule);
    expect(q.tier).toBe("QUALIFIED");
    expect(q.missing).toEqual([]);
  });

  it("missing CEO and email makes it ALMOST, listing the gaps", () => {
    const q = qualifyLead(company({ contacts: [] }), rule);
    expect(q.tier).toBe("ALMOST");
    expect(q.missing).toEqual(expect.arrayContaining(["CEO / Owner name", "CEO / Owner title", "Any business email"]));
  });

  it("missing company phone blocks qualification", () => {
    const q = qualifyLead(company({ phone: null }), rule);
    expect(q.tier).toBe("ALMOST");
    expect(q.missing).toContain("Company phone");
  });

  it("a hard rule failure (commercial-only) is REJECTED, not ALMOST", () => {
    const q = qualifyLead(company({ facts: { ...facts, commercial: fact("YES"), residential: fact("NO") } }), rule);
    expect(q.tier).toBe("REJECTED");
    expect(q.rejectReasons.length).toBeGreaterThan(0);
  });

  it("a state outside the user's filter is REJECTED", () => {
    const q = qualifyLead(company(), { ...rule, geography: { ...rule.geography, states: ["FL"] } });
    expect(q.tier).toBe("REJECTED");
  });

  it("unverified service evidence is not treated as qualified", () => {
    const q = qualifyLead(company({ facts: { hvac: fact("YES") } }), rule);
    expect(q.tier).not.toBe("QUALIFIED");
  });

  it("requiring more fields tightens the gate; requiring none loosens it", () => {
    const strict = { ...rule, completeness: { ...rule.completeness, requiredFields: [...rule.completeness.requiredFields, "employee_count" as const] } };
    expect(qualifyLead(company(), strict).tier).toBe("ALMOST");
    const loose = { ...rule, completeness: { requiredFields: [], requireVerifiedOwner: false } };
    expect(qualifyLead(company({ contacts: [] }), loose).tier).toBe("QUALIFIED");
  });
});
