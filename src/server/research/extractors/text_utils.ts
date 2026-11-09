import * as cheerio from "cheerio";
import { normalizeUsPhone } from "@/server/domain/normalize";

/**
 * Extracts a compact sentence or sentence fragment (30 to 220 chars)
 * containing the target regex or pattern.
 */
export function extractSnippet(text: string, pattern: RegExp, maxLength = 220): string | null {
  const match = pattern.exec(text);
  if (!match) return null;

  const matchIdx = match.index;
  // Look back up to 60 chars for sentence boundary or space
  let startIdx = Math.max(0, matchIdx - 60);
  while (startIdx > 0 && !/[.!?\n]/.test(text[startIdx]!)) {
    startIdx--;
  }
  if (startIdx > 0) startIdx++; // Skip punctuation

  // Look forward up to maxLength
  let endIdx = Math.min(text.length, startIdx + maxLength);
  while (endIdx < text.length && !/[.!?\n]/.test(text[endIdx]!) && endIdx < startIdx + maxLength + 40) {
    endIdx++;
  }
  if (endIdx < text.length && /[.!?]/.test(text[endIdx]!)) {
    endIdx++; // Include terminal period
  }

  const snippet = text.slice(startIdx, endIdx).replace(/\s+/g, " ").trim();
  return snippet.length >= 15 ? snippet : null;
}

/**
 * Extracts all schema.org JSON-LD objects from an HTML document.
 */
export function extractJsonLd(html: string): any[] {
  const $ = cheerio.load(html);
  const results: any[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const content = $(el).contents().text();
      if (!content) return;
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed["@graph"])) {
          results.push(...parsed["@graph"]);
        } else {
          results.push(parsed);
        }
      }
    } catch {
      // ignore invalid json-ld
    }
  });

  return results;
}

/**
 * Finds all phone numbers in HTML (from tel: links or text).
 */
export function extractPhonesFromHtml(html: string): string[] {
  const $ = cheerio.load(html);
  const scoredPhones = new Map<string, number>();
  const recordPhone = (display: string, score: number) => {
    const existing = scoredPhones.get(display);
    if (existing === undefined || score > existing) {
      scoredPhones.set(display, score);
    }
  };
  const isTollFree = (display: string) => /^\(?8(?:00|88|77|66|55|44|33)\)?/.test(display);

  // Check tel: links
  $('a[href^="tel:"]').each((_, el) => {
    const raw = $(el).attr("href")?.replace(/^tel:/i, "") || "";
    const context = `${$(el).text()} ${$(el).parent().text()}`.slice(0, 160);
    if (/\b(fax|facsimile|f\s*:)\b/i.test(context)) return;
    const norm = normalizeUsPhone(raw);
    if (!norm) return;
    const directBoost = /\b(cell|mobile|direct|owner|broker|text|sms)\b/i.test(context) ? 30 : 0;
    const baseScore = isTollFree(norm.display) ? 40 : 90;
    recordPhone(norm.display, baseScore + directBoost);
  });

  // Regex scan body text while rejecting fax / MLS / license numbers
  const text = $("body").text();
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?([2-9][0-8][0-9])\)?[-.\s]?([2-9][0-9]{2})[-.\s]?([0-9]{4})/g;
  let m;
  while ((m = phoneRegex.exec(text)) !== null) {
    const startIdx = Math.max(0, m.index - 28);
    const prefix = text.slice(startIdx, m.index);
    if (/\b(fax|facsimile|f\s*:|mls\s*#?|lic(?:ense)?\s*#?|dre\s*#?|bre\s*#?|parcel|tax\s*id)\s*[-:#]?\s*$/i.test(prefix)) {
      continue;
    }
    const norm = normalizeUsPhone(m[0]);
    if (!norm) continue;
    const surrounding = text.slice(startIdx, Math.min(text.length, m.index + m[0].length + 40));
    const directBoost = /\b(cell|mobile|direct|owner|broker|call|phone|tel|office)\b/i.test(surrounding) ? 15 : 0;
    const baseScore = isTollFree(norm.display) ? 20 : 65;
    recordPhone(norm.display, baseScore + directBoost);
  }

  return Array.from(scoredPhones.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([phone]) => phone);
}

/**
 * Finds all email addresses in HTML (from mailto: links or text).
 */
export function extractEmailsFromHtml(html: string): string[] {
  const $ = cheerio.load(html);
  const emails = new Set<string>();

  // mailto:
  $('a[href^="mailto:"]').each((_, el) => {
    const raw = $(el).attr("href")?.replace(/^mailto:/i, "").split("?")[0] || "";
    const clean = raw.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) && !clean.includes("example.com")) {
      emails.add(clean);
    }
  });

  // text scan
  const text = $("body").text();
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let m;
  while ((m = emailRegex.exec(text)) !== null) {
    const candidate = m[0].toLowerCase();
    if (
      !candidate.endsWith(".png") &&
      !candidate.endsWith(".jpg") &&
      !candidate.includes("sentry") &&
      !candidate.includes("wixpress") &&
      !candidate.includes("example.com")
    ) {
      emails.add(candidate);
    }
  }

  return Array.from(emails);
}
