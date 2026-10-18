import type { CrawledPage } from "../crawler";
import type { FactCandidate } from "./types";
import { extractSnippet } from "./text_utils";

const FINANCING_PATTERNS = [
  /\bfinancing\s+(?:available|options|plans)\b/i,
  /\b(?:wells\s+fargo|synchrony|greensky|goodleap|ftl\s+finance|service\s+finance|microf)\b/i,
  /\b(?:0%|zero\s+percent)\s+(?:apr|interest|financing)\b/i,
  /\blow\s+monthly\s+payments?\b/i,
  /\bapply\s+for\s+financing\b/i,
  /\bbuy\s+now,\s+pay\s+later\b/i,
];

export function extractFinancing(pages: CrawledPage[]): FactCandidate | null {
  for (const page of pages) {
    // Pages like /financing get extra consideration
    const text = page.cleanText;
    if (!text) continue;

    for (const pat of FINANCING_PATTERNS) {
      const snippet = extractSnippet(text, pat);
      if (snippet) {
        return {
          key: "financing",
          value: "YES",
          confidence: page.path.includes("financ") ? 0.96 : 0.90,
          evidenceSnippet: snippet,
          sourceUrl: page.url,
        };
      }
    }
  }

  return null;
}
