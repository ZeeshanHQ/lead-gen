import { describe, expect, it } from "vitest";
import { parseRobotsTxt, isPathAllowed, type CrawledPage } from "@/server/research/crawler";
import { extractAllFacts } from "@/server/research/extractors";
import { calculateLeadScore, defaultHvacRuleConfig, type EvalCompany } from "@/server/domain/rules";
import { createDb } from "@/server/db/client";
import { bootstrap } from "@/server/db/bootstrap";
import { createCandidate } from "@/server/repo/companies";
import { researchCompany } from "@/server/research/engine";
import { getCompanyDetail } from "@/server/repo/detail";

describe("Robots.txt Parser & Crawler Safety", () => {
  it("correctly identifies disallowed paths for Astraventa or *", () => {
    const robots = `
User-agent: Googlebot
Disallow: /private

User-agent: *
Disallow: /admin
Disallow: /checkout
Disallow: /account/

User-agent: AstraventaResearchBot
Disallow: /internal/
`;
    const parsed = parseRobotsTxt(robots, "AstraventaResearchBot");
    expect(parsed.disallowedPaths).toContain("/internal/");
    expect(isPathAllowed("/services", parsed.disallowedPaths)).toBe(true);
    expect(isPathAllowed("/internal/secrets", parsed.disallowedPaths)).toBe(false);
  });

  it("permits standard public HVAC pages", () => {
    const parsed = { disallowedPaths: ["/wp-admin", "/cart"] };
    expect(isPathAllowed("/", parsed.disallowedPaths)).toBe(true);
    expect(isPathAllowed("/services/ac-replacement", parsed.disallowedPaths)).toBe(true);
    expect(isPathAllowed("/about-us", parsed.disallowedPaths)).toBe(true);
    expect(isPathAllowed("/wp-admin/login.php", parsed.disallowedPaths)).toBe(false);
  });
});

describe("Structured Extractors", () => {
  const mockPages: CrawledPage[] = [
    {
      url: "https://www.comfortpros-hvac.com",
      path: "/",
      status: 200,
      title: "Comfort Pros Heating & Air Conditioning | Dallas TX",
      metaDescription: "Top rated residential HVAC contractor in Dallas TX. AC replacement, installation and emergency repair.",
      cleanText:
        "Welcome to Comfort Pros! We are a family-owned residential HVAC contractor serving Dallas and Collin County since 1998. We specialize in residential heating and air conditioning system replacement, new HVAC installation, and 24/7 emergency service. Call our team of certified technicians at (214) 765-4321 for free estimates on new systems. We offer flexible financing options through Wells Fargo with approved credit.",
      html: `
        <html>
          <body>
            <h1>Comfort Pros Heating & Air Conditioning</h1>
            <p>We offer flexible financing options through Wells Fargo.</p>
            <p>Call our certified technicians at <a href="tel:2147654321">(214) 765-4321</a>.</p>
            <form action="/quote"><input name="quote" /></form>
            <script src="https://scheduler.servicetitan.com/embed.js"></script>
          </body>
        </html>
      `,
      links: ["https://www.comfortpros-hvac.com/about", "https://www.comfortpros-hvac.com/services"],
      fetchedAt: new Date().toISOString(),
    },
    {
      url: "https://www.comfortpros-hvac.com/about",
      path: "/about",
      status: 200,
      title: "About Our Team | Comfort Pros",
      metaDescription: "Meet our leadership team.",
      cleanText:
        "Meet the Comfort Pros team! Robert Miller, Owner & President, founded the company in 1998. Robert oversees all installations and replacements. Sarah Jenkins serves as General Manager. Join our team - we are currently hiring licensed service technicians. Join our VIP Comfort Club maintenance plan for annual tune-ups.",
      html: `
        <html>
          <body>
            <h2>Robert Miller</h2>
            <p>Owner & President</p>
            <a href="mailto:robert@comfortpros-hvac.com">robert@comfortpros-hvac.com</a>
            <h2>Sarah Jenkins</h2>
            <p>General Manager</p>
            <a href="mailto:sarah@comfortpros-hvac.com">sarah@comfortpros-hvac.com</a>
          </body>
        </html>
      `,
      links: [],
      fetchedAt: new Date().toISOString(),
    },
  ];

  it("extracts core HVAC facts with verbatim quotes and high confidence", () => {
    const extracted = extractAllFacts(mockPages);

    const factMap = new Map(extracted.facts.map((f) => [f.key, f]));

    expect(factMap.get("hvac")?.value).toBe("YES");
    expect(factMap.get("residential")?.value).toBe("YES");
    expect(factMap.get("replacement")?.value).toBe("YES");
    expect(factMap.get("replacement")?.evidenceSnippet).toContain("replacement");
    expect(factMap.get("installation")?.value).toBe("YES");
    expect(factMap.get("financing")?.value).toBe("YES");
    expect(factMap.get("financing")?.evidenceSnippet).toContain("Wells Fargo");
    expect(factMap.get("maintenance_plans")?.value).toBe("YES");
    expect(factMap.get("free_estimates")?.value).toBe("YES");
    expect(factMap.get("software")?.value).toContain("servicetitan");
  });

  it("extracts leadership decision makers without fabricating", () => {
    const extracted = extractAllFacts(mockPages);

    expect(extracted.contacts.length).toBeGreaterThanOrEqual(2);
    const robert = extracted.contacts.find((c) => c.fullName === "Robert Miller");
    expect(robert).toBeDefined();
    expect(robert?.title).toMatch(/Owner/i);
    expect(robert?.email).toBe("robert@comfortpros-hvac.com");

    const sarah = extracted.contacts.find((c) => c.fullName === "Sarah Jenkins");
    expect(sarah).toBeDefined();
    expect(sarah?.title).toMatch(/General Manager/i);
  });
});

describe("Research Engine End-to-End Execution", () => {
  it("researches a company, stores evidence, creates contacts, and calculates lead score", async () => {
    const handle = await createDb("memory://");
    await bootstrap(handle.db);
    const db = handle.db;

    // Intake candidate
    const intake = await createCandidate(
      db,
      {
        name: "Comfort Pros HVAC",
        website: "https://www.comfortpros-hvac.com",
        state: "TX",
        city: "Dallas",
        provider: "website",
      },
      { actor: "test-user" }
    );
    expect(intake.kind).toBe("created");
    if (intake.kind !== "created") return;

    const companyId = intake.id;

    const mockPages: CrawledPage[] = [
      {
        url: "https://www.comfortpros-hvac.com",
        path: "/",
        status: 200,
        title: "Comfort Pros Heating & Air Conditioning",
        metaDescription: "Residential HVAC contractor in Dallas TX.",
        cleanText:
          "Welcome to Comfort Pros! We are an established residential HVAC contractor in Dallas, TX. We specialize in complete AC replacement and heating installation. We offer 0% APR financing and free estimates. Our team of certified technicians is ready 24/7.",
        html: `<html><body><a href="tel:2147654321">(214) 765-4321</a><script src="https://servicetitan.com"></script></body></html>`,
        links: ["https://www.comfortpros-hvac.com/about"],
        fetchedAt: new Date().toISOString(),
      },
      {
        url: "https://www.comfortpros-hvac.com/about",
        path: "/about",
        status: 200,
        title: "About Us | Comfort Pros",
        metaDescription: "About our leadership.",
        cleanText: "Comfort Pros was founded by Michael Reynolds, Owner. We have over 20 technicians.",
        html: `<html><body><h3>Michael Reynolds</h3><p>Owner</p><a href="mailto:michael@comfortpros-hvac.com">michael@comfortpros-hvac.com</a></body></html>`,
        links: [],
        fetchedAt: new Date().toISOString(),
      },
    ];

    const result = await researchCompany(db, companyId, {
      actor: "Test Agent",
      mockPages,
    });

    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.factsRecorded).toBeGreaterThan(3);
    expect(result.contactsDiscovered).toBeGreaterThanOrEqual(1);
    expect(result.icpScore).toBeGreaterThanOrEqual(70);
    expect(result.grade).toMatch(/^[AB]$/);

    // Verify company details in DB
    const detail = await getCompanyDetail(db, companyId);
    expect(detail).toBeDefined();
    expect(detail?.company.status).toBe("NEEDS_REVIEW");
    expect(detail?.facts.replacement?.value).toBe("YES");
    expect(detail?.facts.website_alive?.value).toBe("YES");
    expect(detail?.evidence.length).toBeGreaterThan(3);
    expect(detail?.contacts.length).toBeGreaterThanOrEqual(1);
    expect(detail?.contacts[0]?.name).toBe("Michael Reynolds");

    await handle.close();
  });
});
