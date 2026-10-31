import { describe, expect, it } from "vitest";
import { isValidPersonName, cleanPersonName } from "@/server/enrichment/people";
import { companyNameFrom, isOffNicheSearchResult } from "@/server/providers/tavily_plan";
import { isNonCompanyHost, normalizeWebsite } from "@/server/domain/normalize";
import { evaluateGate, passesLeadRowGate, resolveGate } from "@/server/domain/gate";
import { extractServices } from "@/server/research/extractors/services";
import { extractLeadershipContacts } from "@/server/research/extractors/contact_and_leadership";
import { buildColdCallerBattlecard } from "@/server/research/engine";

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

    // OTA portals and B2B agency directories must also be blocked
    for (const otaOrDir of ["airbnb.com", "vrbo.com", "booking.com", "designrush.com", "upwork.com"]) {
      expect(isNonCompanyHost(otaOrDir)).toBe(true);
    }
  });

  it("blocks web development, digital marketing, and SEO agencies when searching for Real Estate or STR leads", () => {
    const webDevResult = {
      title: "Apex Real Estate Web Design & Digital Marketing Agency",
      domain: "apexwebagency.com",
      targetKeyword: "real estate brokerage",
      content: "We build custom WordPress websites, SEO campaigns, and PPC lead generation for realtors.",
    };
    expect(isOffNicheSearchResult(webDevResult)).toBe(true);

    const crawledWebDevFacts = extractServices(
      [
        {
          url: "https://apexwebagency.com",
          path: "/",
          status: 200,
          title: "Real Estate Web Design & SEO Agency",
          metaDescription: "",
          html: "<p>We are a full-service web development agency and digital marketing agency offering SEO services for real estate agents.</p>",
          cleanText: "We are a full-service web development agency and digital marketing agency offering SEO services for real estate agents.",
          links: [],
          fetchedAt: new Date().toISOString(),
        },
      ],
      { discovery: { keywords: ["real estate brokerage"] } } as any
    );
    expect(crawledWebDevFacts.some((f) => f.key === "off_niche_vendor" && f.value === "YES")).toBe(true);
    expect(crawledWebDevFacts.some((f) => f.key === "niche_verified" && f.value === "NO")).toBe(true);

    const gate = resolveGate({ requirePhone: true, requireWebsite: true });
    expect(
      passesLeadRowGate(
        {
          name: "PixelCraft Web Development Agency",
          website: "https://pixelcraftweb.com",
          phoneDisplay: "(214) 555-0199",
          status: "NEEDS_REVIEW",
          facts: { off_niche_vendor: { value: "YES" } },
        },
        gate
      )
    ).toBe(false);
  });

  it("strictly enforces Commercial vs Residential polarity and Team/Portfolio Size in passesLeadRowGate", () => {
    const gate = resolveGate({ requirePhone: true, requireWebsite: true });

    const residentialOnlyLead = {
      name: "Sunny Homes Residential Realty",
      website: "https://sunnyhomesrealty.com",
      phoneDisplay: "(512) 555-0144",
      status: "NEEDS_REVIEW",
      facts: {
        residential: { value: "YES" },
        commercial: { value: "NO" },
        employees: { value: "8-15" },
      },
    };

    // Rejected when user sets Commercial Only
    expect(
      passesLeadRowGate(residentialOnlyLead, gate, {
        businessType: "commercial",
      })
    ).toBe(false);

    // Accepted when user sets Residential Only
    expect(
      passesLeadRowGate(residentialOnlyLead, gate, {
        businessType: "residential",
        size: { minEmployees: 5, maxEmployees: 30 },
      })
    ).toBe(true);

    // Rejected when team size is below minEmployees (e.g. minEmployees: 20)
    expect(
      passesLeadRowGate(residentialOnlyLead, gate, {
        businessType: "residential",
        size: { minEmployees: 20, maxEmployees: 50 },
      })
    ).toBe(false);
  });

  it("qualifies professional Airbnb / STR Vacation Rental Managers for 24/7 AI Concierge while rejecting casual 1-room hosts", () => {
    const strManagerFacts = extractServices(
      [
        {
          url: "https://lonestarluxuryvillas.com",
          path: "/",
          status: 200,
          title: "Lone Star Luxury Vacation Rental Management | Austin TX",
          metaDescription: "",
          html: "<p>Full-service Airbnb property management and short-term rental management across 85 luxury vacation rentals in Austin. Powered by Guesty with 24/7 guest support and direct booking concierge.</p>",
          cleanText: "Full-service Airbnb property management and short-term rental management across 85 luxury vacation rentals in Austin. Powered by Guesty with 24/7 guest support and direct booking concierge.",
          links: [],
          fetchedAt: new Date().toISOString(),
        },
      ],
      { discovery: { subNiche: "airbnb_str", keywords: ["vacation rental management company"] } } as any
    );

    expect(strManagerFacts.some((f) => f.key === "str_vacation_rental" && f.value === "YES")).toBe(true);
    expect(strManagerFacts.some((f) => f.key === "after_hours_24_7_need" && f.value === "YES")).toBe(true);
    expect(strManagerFacts.some((f) => f.key === "niche_verified" && f.value === "YES")).toBe(true);

    // Casual 1-room host should be flagged casual_host_only: YES
    const casualHostFacts = extractServices([
      {
        url: "https://myroomsublet.com",
        path: "/",
        status: 200,
        title: "Private Room for Rent",
        metaDescription: "",
        html: "<p>Renting my spare bedroom and shared bathroom for summer sublet roommate wanted.</p>",
        cleanText: "Renting my spare bedroom and shared bathroom for summer sublet roommate wanted.",
        links: [],
        fetchedAt: new Date().toISOString(),
      },
    ]);
    expect(casualHostFacts.some((f) => f.key === "casual_host_only" && f.value === "YES")).toBe(true);

    // Verify 24/7 AI Concierge Cold Caller Battlecard pitch
    const battlecard = buildColdCallerBattlecard({
      companyName: "Lone Star Luxury Villas",
      city: "Austin",
      state: "TX",
      primaryContact: { name: "Marcus Vance", title: "Founder & Managing Partner" },
      facts: {
        str_vacation_rental: { value: "YES", confidence: 0.95, provenance: "PUBLICLY_VERIFIED", evidenceId: "ev1", updatedAt: new Date().toISOString() },
        software: { value: "guesty", confidence: 0.9, provenance: "PUBLICLY_VERIFIED", evidenceId: "ev2", updatedAt: new Date().toISOString() },
      },
      score: 88,
      nicheName: "Airbnb & Vacation Rental Management (24/7 AI Concierge)",
    });
    expect(battlecard.notes).toContain("2 AM");
    expect(battlecard.notes).toContain("24/7 AI Voice Concierge");
  });

  it("extracts personal/mobile direct phone numbers and enforces requireDirectPhone gate", () => {
    const contacts = extractLeadershipContacts([
      {
        url: "https://premiercretexas.com/leadership",
        path: "/leadership",
        status: 200,
        title: "Leadership Team | Premier CRE Texas",
        metaDescription: "",
        html: `
          <div class="team-member">
            <h3>Brandon Keller</h3>
            <p class="role">Managing Principal & Broker</p>
            <p>Mobile: (214) 555-8899 | Email: brandon@premiercretexas.com</p>
          </div>
        `,
        cleanText: "Brandon Keller Managing Principal & Broker Mobile: (214) 555-8899 Email: brandon@premiercretexas.com",
        links: [],
        fetchedAt: new Date().toISOString(),
      },
    ]);

    expect(contacts.length).toBeGreaterThanOrEqual(1);
    expect(contacts[0]?.fullName).toBe("Brandon Keller");
    expect(contacts[0]?.phone).toBe("(214) 555-8899");
    expect(contacts[0]?.phoneType).toBe("PROFESSIONAL_MOBILE");

    const strictDirectGate = resolveGate({
      requirePhone: true,
      requireWebsite: true,
      requireDecisionMaker: true,
      requireDirectPhone: true,
    });

    const evalPass = evaluateGate(strictDirectGate, {
      phone: "(214) 555-0100",
      website: "https://premiercretexas.com",
      websiteAlive: true,
      contacts: [
        {
          name: "Brandon Keller",
          title: "Managing Principal",
          roleClass: "owner",
          phone: "(214) 555-8899",
          phoneType: "PROFESSIONAL_MOBILE",
          email: "brandon@premiercretexas.com",
          emailType: "PUBLIC_BUSINESS",
          verified: true,
        },
      ],
    });
    expect(evalPass.passed).toBe(true);
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
