import type { CrawledPage } from "../crawler";
import type { FactCandidate } from "./types";
import type { RuleConfig } from "@/server/domain/rules";
import { extractSnippet } from "./text_utils";

interface ServiceRule {
  key:
    | "hvac"
    | "residential"
    | "commercial"
    | "replacement"
    | "installation"
    | "repair"
    | "maintenance"
    | "emergency"
    | "indoor_air_quality"
    | "str_vacation_rental"
    | "after_hours_24_7_need";
  patterns: RegExp[];
  confidence: number;
}

const SERVICE_RULES: ServiceRule[] = [
  {
    key: "replacement",
    patterns: [
      /\b(?:ac|air\s+conditioning|hvac|furnace|heat\s+pump|system|roof|water\s+heater|solar)\s+replacement\b/i,
      /\b(?:replace|replacing)\s+(?:your\s+)?(?:old\s+)?(?:ac|hvac|furnace|unit|system|roof)\b/i,
      /\b(?:complete\s+)?(?:system|unit|roof)\s+replacements?\b/i,
      // Real Estate & STR high-ticket services
      /\b(?:residential|commercial|luxury)\s+(?:real\s+estate|brokerage|listings?|property\s+management|vacation\s+rentals?)\b/i,
      /\b(?:buying|selling|leasing|managing)\s+(?:homes?|properties|real\s+estate|vacation\s+rentals?|short[- ]term\s+rentals?)\b/i,
      // Medical / Dental high-ticket services
      /\b(?:dental\s+implants?|cosmetic\s+dentistry|orthodontics?|invisalign|patient\s+care|medical\s+treatments?|specialty\s+clinic|aesthetic\s+treatments?)\b/i,
      // Legal high-ticket services
      /\b(?:personal\s+injury|trial\s+attorneys?|case\s+evaluation|legal\s+representation)\b/i,
    ],
    confidence: 0.94,
  },
  {
    key: "installation",
    patterns: [
      /\b(?:hvac|ac|air\s+conditioning|heating|furnace|heat\s+pump|solar|roofing|plumbing)\s+installation\b/i,
      /\bnew\s+(?:hvac|ac|system|unit|solar|roof)\s+installation\b/i,
      /\binstall(?:ing)?\s+(?:new\s+)?(?:high-efficiency\s+)?(?:systems?|units?|hvac|ac|solar\s+panels?)\b/i,
      // Real Estate / STR / Medical / Professional core service delivery
      /\b(?:full-service\s+(?:brokerage|property\s+management|vacation\s+rental)|property\s+management\s+services?|featured\s+listings?|short[- ]term\s+rental\s+management)\b/i,
      /\b(?:new\s+patient\s+appointments?|book\s+a\s+consultation|board-certified\s+physicians?|healthcare\s+providers?)\b/i,
    ],
    confidence: 0.93,
  },
  {
    key: "residential",
    patterns: [
      /\bresidential\s+(?:hvac|heating|air\s+conditioning|cooling|services?|customers?|real\s+estate|properties|property\s+management|brokerage|solar|roofing|plumbing|sales|leasing)\b/i,
      /\bfor\s+(?:homeowners|patients|families|home\s+buyers|home\s+sellers)\b/i,
      /\bhome\s+(?:comfort|heating|cooling|buyers|sellers|owners)\b/i,
      /\b(?:single[- ]family\s+homes?|luxury\s+homes?|condos?\s+and\s+townhomes?|vacation\s+rentals?|short[- ]term\s+rentals?|vacation\s+homes?|airbnb\s+management)\b/i,
      /\b(?:family\s+medicine|family\s+dentistry|patient-centered\s+care)\b/i,
      /\bresidential\s+specialist\b/i,
    ],
    confidence: 0.92,
  },
  {
    key: "commercial",
    patterns: [
      /\bcommercial\s+(?:hvac|heating|cooling|refrigeration|services?|systems?|real\s+estate|properties|property\s+management|brokerage|leasing|roofing|plumbing|solar|sales|development|advisors?)\b/i,
      /\brooftop\s+units?\b/i,
      /\b(?:tenant\s+representation|landlord\s+representation|industrial\s+(?:properties|real\s+estate|leasing|warehouses?)|office\s+and\s+retail\s+leasing|triple\s+net|cre\s+brokerage|investment\s+sales)\b/i,
      /\bcommercial\s+(?:maintenance|leasing|brokerage|management)\b/i,
    ],
    confidence: 0.90,
  },
  {
    key: "repair",
    patterns: [
      /\b(?:hvac|ac|air\s+conditioning|heating|furnace|roof|plumbing)\s+repairs?\b/i,
      /\bemergency\s+repairs?\b/i,
      /\bfix\s+your\s+(?:ac|furnace|heat|cooling|roof)\b/i,
    ],
    confidence: 0.90,
  },
  {
    key: "maintenance",
    patterns: [
      /\b(?:preventative\s+)?(?:hvac|ac|heating|property|routine|preventive)\s+(?:maintenance|care)\b/i,
      /\b(?:annual|seasonal)\s+(?:tune-?ups?|checkups?|exams?)\b/i,
      /\bsafety\s+inspections?\b/i,
    ],
    confidence: 0.88,
  },
  {
    key: "emergency",
    patterns: [
      /\b24\/7\s+(?:emergency\s+)?(?:service|repairs?|response|care|support|guest\s+support|concierge|maintenance)\b/i,
      /\b(?:emergency|urgent)\s+(?:hvac|heating|ac|medical|dental|care|maintenance)\s+(?:service|appointments?|dispatch)?\b/i,
      /\bafter-hours\s+(?:service|support|check-?in|emergency)\b/i,
    ],
    confidence: 0.91,
  },
  {
    key: "indoor_air_quality",
    patterns: [
      /\bindoor\s+air\s+quality\b/i,
      /\bair\s+(?:purification|purifiers?|filtration|scrubbers?)\b/i,
      /\bduct\s+cleaning\b/i,
      /\bdehumidifiers?\b/i,
    ],
    confidence: 0.89,
  },
  {
    key: "str_vacation_rental",
    patterns: [
      /\b(?:vacation\s+rental|short[- ]term\s+rental|airbnb|vrbo)\s+(?:property\s+)?(?:management|managers?|company|co-?hosting|concierge|services?|portfolio)\b/i,
      /\b(?:full[- ]service\s+(?:airbnb|vacation\s+rental|short[- ]term\s+rental)|co-?hosting\s+services?|vacation\s+home\s+management|serviced\s+apartments?|aparthotel|corporate\s+housing\s+management)\b/i,
      /\b(?:maximize\s+your\s+(?:rental|airbnb|vacation\s+home)\s+(?:income|revenue)|dynamic\s+pricing|guest\s+screening|turnover\s+cleaning|24\/7\s+guest\s+(?:support|communication|concierge))\b/i,
    ],
    confidence: 0.95,
  },
  {
    key: "after_hours_24_7_need",
    patterns: [
      /\b(?:24\/7|24\s+hours?|round[- ]the[- ]clock|after[- ]hours)\s+(?:guest\s+support|concierge|guest\s+communication|check-?in|maintenance|emergency|booking|service|support)\b/i,
      /\b(?:guest\s+concierge|instant\s+booking|book\s+direct|late\s+check-?in|keyless\s+entry|smart\s+lock|guest\s+inquiries|emergency\s+dispatch)\b/i,
      /\b(?:vacation\s+rental\s+management|short[- ]term\s+rental\s+management|airbnb\s+management|property\s+management)\b/i,
    ],
    confidence: 0.92,
  },
  {
    key: "hvac",
    patterns: [
      /\b(?:hvac|heating\s+(?:and|&)\s+(?:cooling|air))\b/i,
      /\bair\s+conditioning\s+contractor\b/i,
      /\bheating\s+contractor\b/i,
      // Core target industry match for non-HVAC niches so ICP fit scoring rewards verified niche websites
      /\b(?:real\s+estate\s+(?:brokerage|agency|group|team|firm|advisors?)|property\s+management|realtors?|commercial\s+real\s+estate)\b/i,
      /\b(?:vacation\s+rental\s+management|short[- ]term\s+rental|airbnb\s+(?:management|co-?host)|serviced\s+apartments?)\b/i,
      /\b(?:medical\s+(?:clinic|center|practice)|healthcare\s+clinic|dental\s+(?:clinic|practice|office)|medspa)\b/i,
      /\b(?:solar\s+(?:company|installer|contractor)|roofing\s+(?:company|contractor)|plumbing\s+(?:company|contractor)|law\s+firm)\b/i,
    ],
    confidence: 0.95,
  },
];

const OFF_NICHE_VENDOR_HEADLINE_REGEX =
  /\b(web\s*design\s*(?:agency|company|studio|services|for)|website\s*development\s*(?:agency|company|services)|custom\s*websites?\s*for\s*(?:realtors|real\s*estate|contractors|hvac)|digital\s*marketing\s*(?:agency|company|firm)|seo\s*(?:agency|company|services|for\s+realtors|for\s+real\s+estate|for\s+contractors)|ppc\s*management\s*agency|social\s*media\s*marketing\s*agency|branding\s*(?:agency|studio)|lead\s*generation\s*(?:agency|company)|marketing\s*(?:agency|solutions)\s*for\s*(?:realtors|real\s*estate|property\s*managers|contractors)|software\s*development\s*company|real\s*estate\s*school|pre-?license\s*course|exam\s*prep|idx\s*website\s*provider|virtual\s*assistant\s*(?:agency|services))\b/i;

const CASUAL_HOST_REGEX =
  /\b(renting\s+my\s+(?:spare\s+)?room|shared\s+room\s+for\s+rent|roommate\s+wanted|sublet\s+my\s+(?:room|apartment)|temporary\s+sublet\s+1\s+room)\b/i;

export function extractServices(pages: CrawledPage[], ruleConfig?: RuleConfig): FactCandidate[] {
  const discovered = new Map<string, FactCandidate>();

  for (const page of pages) {
    const text = page.cleanText;
    if (!text) continue;

    for (const rule of SERVICE_RULES) {
      if (discovered.has(rule.key)) continue;

      for (const pattern of rule.patterns) {
        const snippet = extractSnippet(text, pattern);
        if (snippet) {
          discovered.set(rule.key, {
            key: rule.key,
            value: "YES",
            confidence: rule.confidence,
            evidenceSnippet: snippet,
            sourceUrl: page.url,
          });
          break;
        }
      }
    }
  }

  const combinedTitleAndMeta = pages
    .map((p) => `${p.title || ""} ${p.metaDescription || ""} ${p.url || ""}`)
    .join(" ");
  const combinedText = pages.map((p) => p.cleanText || "").join(" ");
  const primaryUrl = pages[0]?.url || "";

  // Check if user is explicitly searching for a marketing/web agency
  const targetKeywords = ruleConfig?.discovery?.keywords ?? [];
  const joinedKeywords = targetKeywords.join(" ").toLowerCase();
  const userWantsMarketingOrTech =
    /\b(web\s*design|web\s*dev|marketing\s*agency|seo|digital\s*marketing|software|saas|it\s*services|advertising\s*agency)\b/i.test(
      joinedKeywords
    );

  // 1. Detect Off-Niche B2B Vendors (Web Dev, SEO/Marketing Agencies, Software Vendors, Schools)
  const vendorHeadlineHit = extractSnippet(combinedTitleAndMeta, OFF_NICHE_VENDOR_HEADLINE_REGEX);
  const vendorBodyHit =
    !vendorHeadlineHit &&
    /\b(we\s+(?:design|build|develop)\s+websites\s+for|our\s+(?:web\s+design|digital\s+marketing|seo)\s+agency|full[- ]service\s+(?:digital\s+marketing|web\s+design)\s+agency)\b/i.test(
      combinedText
    )
      ? extractSnippet(
          combinedText,
          /\b(we\s+(?:design|build|develop)\s+websites\s+for|our\s+(?:web\s+design|digital\s+marketing|seo)\s+agency|full[- ]service\s+(?:digital\s+marketing|web\s+design)\s+agency)\b/i
        )
      : null;

  if (!userWantsMarketingOrTech && (vendorHeadlineHit || vendorBodyHit)) {
    const snippet = vendorHeadlineHit || vendorBodyHit || "Off-niche B2B marketing/web vendor";
    discovered.set("off_niche_vendor", {
      key: "off_niche_vendor",
      value: "YES",
      confidence: 0.96,
      evidenceSnippet: `Off-niche B2B vendor detected: "${snippet}"`,
      sourceUrl: primaryUrl,
    });
    discovered.set("niche_verified", {
      key: "niche_verified",
      value: "NO",
      confidence: 0.96,
      evidenceSnippet: `Disqualified B2B vendor/agency rather than target prospect: "${snippet}"`,
      sourceUrl: primaryUrl,
    });
  }

  // 2. Check user-configured negativeKeywords against page title & meta
  const negKeywords = ruleConfig?.discovery?.negativeKeywords ?? [];
  if (!discovered.has("off_niche_vendor") && negKeywords.length > 0) {
    const lowerTitleMeta = combinedTitleAndMeta.toLowerCase();
    for (const neg of negKeywords) {
      const cleanNeg = neg.trim().toLowerCase();
      if (cleanNeg.length >= 3 && lowerTitleMeta.includes(cleanNeg)) {
        discovered.set("niche_verified", {
          key: "niche_verified",
          value: "NO",
          confidence: 0.94,
          evidenceSnippet: `Excluded by negative keyword "${neg}" in page title/metadata`,
          sourceUrl: primaryUrl,
        });
        break;
      }
    }
  }

  // 3. Detect Casual 1-Room / Temporary Host (when targeting professional STR / Property Managers)
  const casualHit = extractSnippet(combinedText, CASUAL_HOST_REGEX);
  if (casualHit && !discovered.has("str_vacation_rental")) {
    discovered.set("casual_host_only", {
      key: "casual_host_only",
      value: "YES",
      confidence: 0.92,
      evidenceSnippet: `Casual single-room / temporary sublet detected: "${casualHit}"`,
      sourceUrl: primaryUrl,
    });
  }

  // 4. Enforce Commercial vs Residential Polarity when website has clear focus
  // If a site has Commercial = YES and zero Residential signals (or says "commercial only"), mark Residential = NO.
  // If a site has Residential = YES and zero Commercial signals (or says "residential only"), mark Commercial = NO.
  if (combinedText.length > 150) {
    const hasResidential = discovered.has("residential") || discovered.has("str_vacation_rental");
    const hasCommercial = discovered.has("commercial");

    if (hasCommercial && !hasResidential) {
      discovered.set("residential", {
        key: "residential",
        value: "NO",
        confidence: 0.86,
        evidenceSnippet: "Exclusively commercial focus evidenced on crawled pages (no residential services listed)",
        sourceUrl: primaryUrl,
      });
    } else if (hasResidential && !hasCommercial) {
      discovered.set("commercial", {
        key: "commercial",
        value: "NO",
        confidence: 0.86,
        evidenceSnippet: "Exclusively residential focus evidenced on crawled pages (no commercial services listed)",
        sourceUrl: primaryUrl,
      });
    }
  }

  // 5. Verify Niche Relevance (niche_verified = YES / NO)
  if (!discovered.has("niche_verified") && combinedText.length > 100) {
    const fullLower = `${combinedTitleAndMeta} ${combinedText}`.toLowerCase();
    let matchedKeyword: string | null = null;

    if (targetKeywords.length > 0) {
      const stopWords = new Set(["company", "services", "service", "firm", "agency", "group", "local", "top", "best", "near", "office", "center", "practice"]);
      for (const kw of targetKeywords) {
        const tokens = kw
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length >= 3 && !stopWords.has(t));
        if (tokens.length > 0 && tokens.some((t) => fullLower.includes(t))) {
          matchedKeyword = kw;
          break;
        }
      }
    }

    if (
      matchedKeyword ||
      discovered.has("hvac") ||
      discovered.has("str_vacation_rental") ||
      discovered.has("replacement") ||
      discovered.has("installation")
    ) {
      discovered.set("niche_verified", {
        key: "niche_verified",
        value: "YES",
        confidence: 0.94,
        evidenceSnippet: matchedKeyword
          ? `Verified match for target ICP keyword "${matchedKeyword}"`
          : "Verified core niche service signals on website",
        sourceUrl: primaryUrl,
      });
    } else if (targetKeywords.length > 0 && combinedText.length > 350) {
      discovered.set("niche_verified", {
        key: "niche_verified",
        value: "NO",
        confidence: 0.90,
        evidenceSnippet: `No target ICP keywords (${targetKeywords.slice(0, 3).join(", ")}) found on website`,
        sourceUrl: primaryUrl,
      });
    }
  }

  return Array.from(discovered.values());
}
