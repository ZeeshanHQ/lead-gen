import type { CrawledPage } from "../crawler";
import type { FactCandidate } from "./types";
import { extractSnippet } from "./text_utils";

const MAINTENANCE_PLAN_PATTERNS = [
  /\b(?:maintenance|service)\s+(?:agreement|plan|program)s?\b/i,
  /\b(?:comfort|vip|peace\s+of\s+mind|energy\s+savings?)\s+club\b/i,
  /\bannual\s+(?:maintenance|service)\s+(?:membership|plan)\b/i,
  /\bprecision\s+tune-?up\s+(?:program|plan)\b/i,
];

export function extractMaintenancePlans(pages: CrawledPage[]): FactCandidate | null {
  for (const page of pages) {
    const text = page.cleanText;
    if (!text) continue;

    for (const pat of MAINTENANCE_PLAN_PATTERNS) {
      const snippet = extractSnippet(text, pat);
      if (snippet) {
        return {
          key: "maintenance_plans",
          value: "YES",
          confidence: page.path.includes("club") || page.path.includes("maintenance") ? 0.95 : 0.88,
          evidenceSnippet: snippet,
          sourceUrl: page.url,
        };
      }
    }
  }

  return null;
}
