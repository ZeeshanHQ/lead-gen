import type { CrawledPage } from "../crawler";
import type { FactCandidate } from "./types";
import { extractSnippet } from "./text_utils";

interface ServiceRule {
  key: "hvac" | "residential" | "commercial" | "replacement" | "installation" | "repair" | "maintenance" | "emergency" | "indoor_air_quality";
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
      // Real Estate high-ticket services
      /\b(?:residential|commercial|luxury)\s+(?:real\s+estate|brokerage|listings?|property\s+management)\b/i,
      /\b(?:buying|selling|leasing)\s+(?:homes?|properties|real\s+estate)\b/i,
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
      // Real Estate / Medical / Professional core service delivery
      /\b(?:full-service\s+brokerage|property\s+management\s+services?|featured\s+listings?)\b/i,
      /\b(?:new\s+patient\s+appointments?|book\s+a\s+consultation|board-certified\s+physicians?|healthcare\s+providers?)\b/i,
    ],
    confidence: 0.93,
  },
  {
    key: "residential",
    patterns: [
      /\bresidential\s+(?:hvac|heating|air\s+conditioning|cooling|services?|customers?|real\s+estate|properties|solar|roofing|plumbing)\b/i,
      /\bfor\s+(?:homeowners|patients|families|buyers|sellers)\b/i,
      /\bhome\s+(?:comfort|heating|cooling|buyers|sellers|owners)\b/i,
      /\b(?:family\s+medicine|family\s+dentistry|patient-centered\s+care)\b/i,
      /\bresidential\s+specialist\b/i,
    ],
    confidence: 0.92,
  },
  {
    key: "commercial",
    patterns: [
      /\bcommercial\s+(?:hvac|heating|cooling|refrigeration|services?|systems?|real\s+estate|properties|roofing|plumbing|solar)\b/i,
      /\brooftop\s+units?\b/i,
      /\bcommercial\s+(?:maintenance|leasing|brokerage|management)\b/i,
    ],
    confidence: 0.88,
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
      /\b24\/7\s+(?:emergency\s+)?(?:service|repairs?|response|care|support)\b/i,
      /\b(?:emergency|urgent)\s+(?:hvac|heating|ac|medical|dental|care)\s+(?:service|appointments?)?\b/i,
      /\bafter-hours\s+service\b/i,
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
    key: "hvac",
    patterns: [
      /\b(?:hvac|heating\s+(?:and|&)\s+(?:cooling|air))\b/i,
      /\bair\s+conditioning\s+contractor\b/i,
      /\bheating\s+contractor\b/i,
      // Core target industry match for non-HVAC niches so ICP fit scoring rewards verified niche websites
      /\b(?:real\s+estate\s+(?:brokerage|agency|group|team)|property\s+management|realtors?)\b/i,
      /\b(?:medical\s+(?:clinic|center|practice)|healthcare\s+clinic|dental\s+(?:clinic|practice|office)|medspa)\b/i,
      /\b(?:solar\s+(?:company|installer|contractor)|roofing\s+(?:company|contractor)|plumbing\s+(?:company|contractor)|law\s+firm)\b/i,
    ],
    confidence: 0.95,
  },
];

export function extractServices(pages: CrawledPage[]): FactCandidate[] {
  const discovered = new Map<string, FactCandidate>();

  for (const page of pages) {
    const text = page.cleanText;
    if (!text) continue;

    for (const rule of SERVICE_RULES) {
      if (discovered.has(rule.key)) continue; // Keep highest priority or first strong occurrence

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

  return Array.from(discovered.values());
}
