import type { CrawledPage } from "../crawler";
import type { FactCandidate } from "./types";
import { formatSoftware, type SoftwareKey } from "@/server/domain/facts";

interface TechSignature {
  key: SoftwareKey;
  patterns: RegExp[];
  label: string;
}

const SIGNATURES: TechSignature[] = [
  {
    key: "servicetitan",
    patterns: [
      /servicetitan\.com/i,
      /scheduler\.servicetitan\.com/i,
      /titan-schedule/i,
      /servicetitan-widget/i,
    ],
    label: "ServiceTitan",
  },
  {
    key: "jobber",
    patterns: [
      /getjobber\.com/i,
      /clienthub\.getjobber\.com/i,
      /jobber-embed/i,
    ],
    label: "Jobber",
  },
  {
    key: "housecall_pro",
    patterns: [
      /housecallpro\.com/i,
      /housecall-pro/i,
      /pro\.housecall/i,
    ],
    label: "Housecall Pro",
  },
  {
    key: "other",
    patterns: [
      /scheduleengine\.com/i,
      /podium\.com/i,
      /chiirp\.com/i,
      /fieldedge\.com/i,
      /successware\.com/i,
    ],
    label: "FSM/Chat Tool",
  },
];

export function detectTechnology(pages: CrawledPage[]): FactCandidate | null {
  const detectedKeys = new Set<SoftwareKey>();
  const evidenceList: string[] = [];
  let sourceUrl = "";

  for (const page of pages) {
    const rawHtml = page.html;
    if (!rawHtml) continue;

    for (const sig of SIGNATURES) {
      if (detectedKeys.has(sig.key)) continue;

      for (const pat of sig.patterns) {
        if (pat.test(rawHtml)) {
          detectedKeys.add(sig.key);
          if (!sourceUrl) sourceUrl = page.url;
          evidenceList.push(`Found ${sig.label} signature matching ${pat.source} at ${page.url}`);
          break;
        }
      }
    }
  }

  if (detectedKeys.size === 0) return null;

  return {
    key: "software",
    value: formatSoftware(Array.from(detectedKeys)),
    confidence: 0.95,
    evidenceSnippet: evidenceList.join("; "),
    sourceUrl: sourceUrl || pages[0]?.url || "",
  };
}
