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

    // 10. Employee & Team Size Extraction (Real-time Affordability Signal)
    if (!discovered.has("employees")) {
      // 10a. Schema.org JSON-LD numberOfEmployees check
      const schemaEmp = html.match(/"numberOfEmployees"\s*:\s*(?:\{\s*"@type":\s*"QuantitativeValue",\s*"value":\s*"?(\d{1,4})"?|"?(\d{1,4})"?)/i);
      if (schemaEmp) {
        const empVal = schemaEmp[1] || schemaEmp[2];
        if (empVal && parseInt(empVal, 10) >= 1) {
          facts.push({
            key: "employees",
            value: empVal,
            confidence: 0.95,
            evidenceSnippet: `Schema.org declared employee count: ${empVal}`,
            sourceUrl: page.url,
          });
          discovered.add("employees");
        }
      }

      // 10b. Natural language team count statements (e.g. "team of 15 agents", "over 25 specialists")
      if (!discovered.has("employees")) {
        const empPat = /\b(?:team\s+of|staff\s+of|more\s+than|over|employing|consisting\s+of)\s+(\d{1,3})\s+(?:agents?|realtors?|brokers?|technicians?|specialists?|professionals?|employees?|members?|associates?)\b/i;
        const match = empPat.exec(text);
        if (match && match[1]) {
          const count = parseInt(match[1], 10);
          if (count >= 2 && count <= 500) {
            facts.push({
              key: "employees",
              value: `${count}`,
              confidence: 0.88,
              evidenceSnippet: match[0],
              sourceUrl: page.url,
            });
            discovered.add("employees");
          }
        }
      }

      // 10c. Team roster / agent cards count on team or about pages
      if (!discovered.has("employees") && (page.path.includes("team") || page.path.includes("agent") || page.path.includes("about") || page.path.includes("staff") || page.path.includes("realtor"))) {
        const $ = cheerio.load(html);
        const cardCount = $(".team-member, .team-card, [class*='agent-card'], [class*='member-card'], [class*='agent-item'], .person-card, .bio-card").length;
        if (cardCount >= 3 && cardCount <= 150) {
          facts.push({
            key: "employees",
            value: `${cardCount}`,
            confidence: 0.85,
            evidenceSnippet: `${cardCount} team member profiles displayed on roster page`,
            sourceUrl: page.url,
          });
          discovered.add("employees");
        }
      }
    }

    // 11. Solo / 1-Person Operation detection
    if (!discovered.has("one_person_operation")) {
      const soloPat = /\b(?:solo\s+practitioner|individual\s+agent|individual\s+broker|one-person\s+operation|sole\s+proprietorship)\b/i;
      const snippet = extractSnippet(text, soloPat);
      if (snippet) {
        facts.push({
          key: "one_person_operation",
          value: "YES",
          confidence: 0.90,
          evidenceSnippet: snippet,
          sourceUrl: page.url,
        });
        discovered.add("one_person_operation");
      }
    }

    // 12. Google Ads & Search Marketing Tracking (Bleeding Ad Spend Indicator)
    if (!discovered.has("google_ads")) {
      const googleAdsPat = /(?:googleads\.g\.doubleclick\.net|google_conversion_id|googletagmanager\.com\/gtag\/js\?id=AW-|gtag\s*\(\s*['"]config['"],\s*['"]AW-[A-Za-z0-9_-]+['"]|data-google-ad-click)/i;
      const snippet = extractSnippet(html, googleAdsPat);
      if (snippet || html.includes("googletagmanager.com/gtag/js?id=AW-") || /gtag\s*\(\s*['"]config['"],\s*['"]AW-/i.test(html)) {
        facts.push({
          key: "google_ads",
          value: "YES",
          confidence: 0.96,
          evidenceSnippet: "Active Google Ads Conversion Tracking (AW tag / AdWords) detected on website",
          sourceUrl: page.url,
        });
        facts.push({
          key: "bleeding_ads",
          value: "YES",
          confidence: 0.96,
          evidenceSnippet: "Actively spending budget on Google Ads / search advertising",
          sourceUrl: page.url,
        });
        discovered.add("google_ads");
        discovered.add("bleeding_ads");
      }
    }

    // 13. Zillow Premier Agent & Real Estate Portal Advertising
    if (!discovered.has("zillow_advertiser")) {
      const zillowPat = /(?:zillow\.com\/profile\/|zillow\.com\/agent-reviews\/|zillow\s+premier\s+agent|find\s+(?:us|me)\s+on\s+zillow|premier\s+agent\s+on\s+zillow|zillow\s+5-star|zillow-badge)/i;
      const snippet = extractSnippet(html, zillowPat) || extractSnippet(text, zillowPat);
      if (snippet) {
        facts.push({
          key: "zillow_advertiser",
          value: "YES",
          confidence: 0.94,
          evidenceSnippet: `Zillow Premier Agent / profile presence identified: "${snippet}"`,
          sourceUrl: page.url,
        });
        if (!discovered.has("bleeding_ads")) {
          facts.push({
            key: "bleeding_ads",
            value: "YES",
            confidence: 0.94,
            evidenceSnippet: "Actively investing in Zillow Premier Agent / Real Estate portal lead gen",
            sourceUrl: page.url,
          });
          discovered.add("bleeding_ads");
        }
        discovered.add("zillow_advertiser");
      }
    }

    // 14. Property Management: Units / Doors Managed (Scale & Affordability)
    if (!discovered.has("doors_managed")) {
      const doorsPat = /\b(?:managing|manage|over|portfolio\s+of|more\s+than)\s+(\d{2,4})\s+(?:doors|units|properties|homes|rentals)\b/i;
      const match = doorsPat.exec(text);
      if (match && match[1]) {
        const count = parseInt(match[1], 10);
        if (count >= 15 && count <= 5000) {
          facts.push({
            key: "doors_managed",
            value: `${count}`,
            confidence: 0.91,
            evidenceSnippet: match[0],
            sourceUrl: page.url,
          });
          discovered.add("doors_managed");
        }
      } else {
        const doorsPlusPat = /\b(\d{2,4})\+\s*(?:doors|units|properties|rentals)\b/i;
        const plusMatch = doorsPlusPat.exec(text);
        if (plusMatch && plusMatch[1]) {
          const count = parseInt(plusMatch[1], 10);
          if (count >= 20 && count <= 5000) {
            facts.push({
              key: "doors_managed",
              value: `${count}+`,
              confidence: 0.88,
              evidenceSnippet: plusMatch[0],
              sourceUrl: page.url,
            });
            discovered.add("doors_managed");
          }
        }
      }
    }

    // 15. Real Estate: Average Property Value & High-Ticket Inventory ($400k+)
    if (!discovered.has("avg_property_value")) {
      const luxuryPat = /\b(?:luxury\s+portfolio|sotheby's\s+international|million\s+dollar\s+guild|christie's\s+international|luxury\s+homes?|high-end\s+estates?)\b/i;
      const luxurySnippet = extractSnippet(text, luxuryPat);
      
      const highPriceMatches = text.match(/\$(?:[4-9]\d{2}|[1-9]\d{3}),\d{3}\b/g) || [];
      const medPriceMatches = text.match(/\$\d{3},\d{3}\b/g) || [];

      if (luxurySnippet || highPriceMatches.length >= 2 || (highPriceMatches.length >= 1 && highPriceMatches.length >= medPriceMatches.length * 0.5)) {
        facts.push({
          key: "avg_property_value",
          value: "$400k+",
          confidence: luxurySnippet ? 0.95 : 0.88,
          evidenceSnippet: luxurySnippet ? `Luxury brokerage affiliation: "${luxurySnippet}"` : `Multiple inventory listings in $400k+ bracket (${highPriceMatches.slice(0, 3).join(", ")})`,
          sourceUrl: page.url,
        });
        facts.push({
          key: "luxury_high_value",
          value: "YES",
          confidence: luxurySnippet ? 0.95 : 0.88,
          evidenceSnippet: luxurySnippet ? `Luxury affiliation: "${luxurySnippet}"` : "High-ticket property portfolio",
          sourceUrl: page.url,
        });
        discovered.add("avg_property_value");
        discovered.add("luxury_high_value");
      }
    }
  }

  return facts;
}
