import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";
import type { FactCandidate } from "./types";
import { extractSnippet } from "./text_utils";

export function extractBusinessSignals(pages: CrawledPage[]): FactCandidate[] {
  const facts: FactCandidate[] = [];
  const discovered = new Set<string>();

  for (const page of pages) {
    const text = page.cleanText;
    const html = page.html;
    if (!text) continue;

    // 1. Free Estimates
    if (!discovered.has("free_estimates")) {
      const freeEstPat = /\bfree\s+(?:in-home\s+)?(?:estimates?|quotes?|consultations?)\b/i;
      const snippet = extractSnippet(text, freeEstPat);
      if (snippet) {
        facts.push({
          key: "free_estimates",
          value: "YES",
          confidence: 0.93,
          evidenceSnippet: snippet,
          sourceUrl: page.url,
        });
        discovered.add("free_estimates");
      }
    }

    // 2. Online Booking
    if (!discovered.has("online_booking")) {
      const bookingPat = /\b(?:schedule|book)\s+(?:an?\s+appointment\s+)?online\b/i;
      const snippet = extractSnippet(text, bookingPat);
      if (snippet) {
        facts.push({
          key: "online_booking",
          value: "YES",
          confidence: 0.91,
          evidenceSnippet: snippet,
          sourceUrl: page.url,
        });
        discovered.add("online_booking");
      }
    }

    // 3. Quote Form
    if (!discovered.has("quote_form")) {
      const quotePat = /\b(?:request|get)\s+a\s+(?:free\s+)?(?:quote|estimate)\b/i;
      const $ = cheerio.load(html);
      const hasForm = $("form").length > 0;
      const snippet = extractSnippet(text, quotePat);
      if (hasForm && snippet) {
        facts.push({
          key: "quote_form",
          value: "YES",
          confidence: 0.94,
          evidenceSnippet: `Online request form detected: "${snippet}"`,
          sourceUrl: page.url,
        });
        discovered.add("quote_form");
      }
    }

    // 4. Hiring
    if (!discovered.has("hiring")) {
      const hiringPat = /\b(?:now\s+hiring|join\s+our\s+team|career\s+opportunities|we're\s+hiring\s+technicians?)\b/i;
      const snippet = extractSnippet(text, hiringPat);
      if (snippet || page.path.includes("career") || page.path.includes("jobs")) {
        facts.push({
          key: "hiring",
          value: "YES",
          confidence: 0.92,
          evidenceSnippet: snippet || `Careers page identified at ${page.path}`,
          sourceUrl: page.url,
        });
        discovered.add("hiring");
      }
    }

    // 5. Multiple Technicians
    if (!discovered.has("multiple_technicians")) {
      const techPat = /\b(?:our\s+team\s+of\s+(?:certified\s+)?technicians|fleet\s+of\s+trucks|experienced\s+technicians|certified\s+comfort\s+advisors)\b/i;
      const snippet = extractSnippet(text, techPat);
      if (snippet) {
        facts.push({
          key: "multiple_technicians",
          value: "YES",
          confidence: 0.88,
          evidenceSnippet: snippet,
          sourceUrl: page.url,
        });
        discovered.add("multiple_technicians");
      }
    }

    // 6. Multiple Service Areas
    if (!discovered.has("multiple_service_areas")) {
      const areaPat = /\b(?:proudly\s+)?serving\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/;
      const snippet = extractSnippet(text, areaPat);
      if (snippet || page.path.includes("service-area") || page.path.includes("areas-we-serve")) {
        facts.push({
          key: "multiple_service_areas",
          value: "YES",
          confidence: 0.89,
          evidenceSnippet: snippet || `Service areas index detected at ${page.path}`,
          sourceUrl: page.url,
        });
        discovered.add("multiple_service_areas");
      }
    }

    // 7. Multiple Locations
    if (!discovered.has("multiple_locations")) {
      const locPat = /\b(?:our\s+locations|multiple\s+locations|serving\s+from\s+\d+\s+offices)\b/i;
      const snippet = extractSnippet(text, locPat);
      if (snippet || (page.path.includes("locations") && !page.path.endsWith("/location"))) {
        facts.push({
          key: "multiple_locations",
          value: "YES",
          confidence: 0.87,
          evidenceSnippet: snippet || `Locations directory detected at ${page.path}`,
          sourceUrl: page.url,
        });
        discovered.add("multiple_locations");
      }
    }

    // 8. Established Business
    if (!discovered.has("established_business")) {
      const estPat = /\b(?:established\s+in\s+|since\s+|serving\s+(?:the\s+area\s+)?for\s+over\s+\d+\s+years|founded\s+in\s+\d{4})\b/i;
      const snippet = extractSnippet(text, estPat);
      if (snippet) {
        facts.push({
          key: "established_business",
          value: "YES",
          confidence: 0.93,
          evidenceSnippet: snippet,
          sourceUrl: page.url,
        });
        discovered.add("established_business");
      }
    }

    // 9. Strong Public Presence / Reputation & Premier Brand Dealer Status
    if (!discovered.has("strong_presence")) {
      // Check Brand Premier Dealer certifications (Massive high-ticket signal)
      const brandPat = /\b(lennox\s+premier\s+dealer|carrier\s+factory\s+authorized(?:\s+dealer)?|trane\s+comfort\s+specialist|daikin\s+comfort\s+pro|rheem\s+pro\s+partner|american\s+standard\s+customer\s+care|mitsubishi\s+(?:electric\s+)?diamond\s+contractor|york\s+certified\s+comfort\s+expert)\b/i;
      const brandSnippet = extractSnippet(text, brandPat);

      const repPat = /\b(?:google\s+guaranteed|bbb\s+accredited|hundreds\s+of\s+5-star\s+reviews|\d{2,}\+\s+five-star\s+reviews|diamond\s+certified)\b/i;
      const snippet = extractSnippet(text, repPat);

      if (brandSnippet) {
        facts.push({
          key: "strong_presence",
          value: "YES",
          confidence: 0.96,
          evidenceSnippet: `Authorized Manufacturer Certification: "${brandSnippet}"`,
          sourceUrl: page.url,
        });
        discovered.add("strong_presence");
      } else if (snippet) {
        facts.push({
          key: "strong_presence",
          value: "YES",
          confidence: 0.90,
          evidenceSnippet: snippet,
          sourceUrl: page.url,
        });
        discovered.add("strong_presence");
      }
    }

    // Check Schema.org JSON-LD for reviewCount and ratingValue
    const jsonLds = (page.html.includes("aggregateRating") || page.html.includes("AggregateRating"))
      ? extractSnippet(page.html, /"aggregateRating"|"reviewCount"/i)
      : null;
    if (jsonLds && !discovered.has("strong_presence")) {
      const matchReviews = page.html.match(/"reviewCount":\s*"?(\d+)"?/);
      const matchRating = page.html.match(/"ratingValue":\s*"?([\d.]+)"?/);
      if (matchReviews && matchReviews[1]) {
        facts.push({
          key: "strong_presence",
          value: "YES",
          confidence: 0.97,
          evidenceSnippet: `Schema.org Verified Reputation: ${matchReviews[1]} customer reviews (${matchRating?.[1] || "5.0"}/5 stars)`,
          sourceUrl: page.url,
        });
        discovered.add("strong_presence");
      }
    }

    // 10. Employee count hints (e.g. "team of 15 technicians")
    if (!discovered.has("employees")) {
      const empPat = /\bteam\s+of\s+(\d{1,3})\s+(?:technicians|specialists|professionals|employees)\b/i;
      const match = empPat.exec(text);
      if (match && match[1]) {
        const count = parseInt(match[1], 10);
        if (count >= 2 && count <= 200) {
          facts.push({
            key: "employees",
            value: `${count}`,
            confidence: 0.85,
            evidenceSnippet: match[0],
            sourceUrl: page.url,
          });
          discovered.add("employees");
        }
      }
    }
  }

  return facts;
}
