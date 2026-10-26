import { describe, expect, it } from "vitest";
import { isValidPersonName, cleanPersonName } from "@/server/enrichment/people";
import { companyNameFrom } from "@/server/providers/tavily_plan";
import { isNonCompanyHost, normalizeWebsite } from "@/server/domain/normalize";
import { evaluateGate } from "@/server/domain/gate";

describe("Dump Data Prevention & Quality Shields", () => {
  it("strictly rejects fake, entity, and hallucinated person names", () => {
    const dumpNames = [
      "Board of directors",
      "No result found",
      "United States",
      "Awards & Accolades",
      "Champions Leadership",
      "Real Academy",
      "National Leadership",
      "Ashley Conlon | President",
      "Join us.",
      "Owner / Managing Director",
      "Decision Maker",
      "Customer Reviews",
      "Our Expert Technicians",
      "Contact Us Today",
      "Privacy Policy",
      "HVAC Services",
    ];

    for (const name of dumpNames) {
      expect(isValidPersonName(name)).toBe(false);
      expect(cleanPersonName(name)).toBeNull();
    }
  });

  it("accurately validates real human person names", () => {
    const validNames = [
      "John Smith",
      "Sarah Jenkins",
      "Brandon Keller",
      "Damon Williamson",
      "Megan Williamson",
      "Rachel Thornton",
      "Jason Mercer",
      "Amanda Vance",
      "Christopher Hayes",
      "Lauren Gallagher",
      "Victoria Sterling",
      "Dr. Robert McDonald",
    ];

    for (const name of validNames) {
      expect(isValidPersonName(name)).toBe(true);
      expect(cleanPersonName(name)).toBeTruthy();
    }
  });

  it("extracts clean brand names instead of editorial blog headlines", () => {
    // Blog title with separator: takes clean brand segment or domain
    expect(
      companyNameFrom(
        "What It Means To Be A Carrier Factory Authorized Dealer | AC Systems Inc.",
        "acsystemsinc.com"
      )
    ).toBe("AC Systems Inc.");

    // Blog title with no delimiter: rejects headline and derives clean brand from domain
    expect(
      companyNameFrom(
        "Why You Should Hire a Carrier Factory Authorized Dealer",
        "dtctexas.com"
      )
    ).toBe("Dtctexas");

    // Listicle title: rejects listicle and falls back to clean domain brand
    expect(
      companyNameFrom(
        "Top Reasons to Hire a Carrier Factory Authorized Dealer",
        "coolmenow.com"
      )
    ).toBe("Coolmenow");

    // URL path slug: rejects URL paths
    expect(companyNameFrom("roster/Agents", "daveperrymiller.com")).toBe("Daveperrymiller");

    // Generic button text
    expect(companyNameFrom("Contact Us", "championsschool.com")).toBe("Championsschool");
  });

  it("blocks portals, aggregators, and equipment manufacturers from being treated as direct company websites", () => {
    const blockedHosts = [
      "zillow.com",
      "realtor.com",
      "redfin.com",
      "nar.realtor",
      "lennox.com",
      "carrier.com",
      "trane.com",
      "yelp.com",
      "angi.com",
      "bbb.org",
    ];

    for (const host of blockedHosts) {
      expect(isNonCompanyHost(host)).toBe(true);
      const norm = normalizeWebsite(`https://${host}`);
      expect(norm.ok).toBe(false);
    }

    // Direct contractor website should pass
    const directSite = normalizeWebsite("https://apexheatingcooling.com");
    expect(directSite.ok).toBe(true);
  });

  it("ensures Lead Gate rejects fake decision makers", () => {
    // Gate with requireDecisionMaker: true
    const gate = { requireDecisionMaker: true, requirePhone: true, requireWebsite: true };

    // Fails when contact has dump name
    const resultWithDumpName = evaluateGate(gate, {
      phone: "(214) 555-1234",
      website: "https://example.com",
      websiteAlive: true,
      contacts: [
        {
          id: "c1",
          name: "Board of directors",
          title: "President",
          roleClass: "president",
          email: null,
          emailType: "UNKNOWN",
          phone: null,
          phoneType: "UNKNOWN",
          verified: true,
        },
      ],
    });
    expect(resultWithDumpName.passed).toBe(false);
    expect(resultWithDumpName.missing).toContain("requireDecisionMaker");

    // Passes when contact has real person name
    const resultWithRealName = evaluateGate(gate, {
      phone: "(214) 555-1234",
      website: "https://example.com",
      websiteAlive: true,
      contacts: [
        {
          id: "c2",
          name: "David Callahan",
          title: "Managing Partner",
          roleClass: "general_manager",
          email: "david@example.com",
          emailType: "PUBLIC_BUSINESS",
          phone: "(512) 555-4321",
          phoneType: "PUBLISHED_DIRECT",
          verified: true,
        },
      ],
    });
    expect(resultWithRealName.passed).toBe(true);
  });
});
