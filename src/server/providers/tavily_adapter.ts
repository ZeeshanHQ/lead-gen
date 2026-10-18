import type { DiscoveredCandidate, DiscoveryAdapter, DiscoveryQuery, ProviderMetadata } from "./types";
import { normalizeUsPhone, normalizeWebsite } from "@/server/domain/normalize";

export const TAVILY_PROVIDER_METADATA: ProviderMetadata = {
  id: "tavily_search",
  name: "Tavily Search API (Real-Time Web Discovery)",
  category: "search",
  description: "Real-time AI-optimized web search engine for discovering active HVAC contractor domains, websites, and public local listings.",
  requiresApiKey: true,
  costPerRequestUsd: 0.001,
  attributionNotice: "Search results powered by Tavily Search API (tavily.com).",
  retentionPolicyDays: 90,
};

// Known aggregators and social networks to exclude from direct contractor candidates
const EXCLUDED_AGGREGATOR_DOMAINS = [
  "yelp.com",
  "angi.com",
  "thumbtack.com",
  "bbb.org",
  "yellowpages.com",
  "forbes.com",
  "wikipedia.org",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "reddit.com",
  "quora.com",
  "mapquest.com",
  "superpages.com",
  "expertise.com",
  "homeadvisor.com",
  "consumeraffairs.com",
  "chamberofcommerce.com",
  "indeed.com",
  "ziprecruiter.com",
  "glassdoor.com",
];

const STATE_NAMES: Record<string, string> = {
  TX: "Texas",
  FL: "Florida",
  GA: "Georgia",
  NC: "North Carolina",
  OH: "Ohio",
  AZ: "Arizona",
  IL: "Illinois",
  CA: "California",
  CO: "Colorado",
  PA: "Pennsylvania",
  TN: "Tennessee",
  VA: "Virginia",
};

export function getTavilyApiKey(config?: Record<string, unknown>): string {
  if (config && typeof config.apiKey === "string" && config.apiKey.trim().length > 5) {
    return config.apiKey.trim();
  }
  if (process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.trim().length > 5) {
    return process.env.TAVILY_API_KEY.trim();
  }
  if (process.env.SEARCH_API_KEY && process.env.SEARCH_API_KEY.trim().length > 5) {
    return process.env.SEARCH_API_KEY.trim();
  }
  return "";
}

export class TavilyAdapter implements DiscoveryAdapter {
  metadata = TAVILY_PROVIDER_METADATA;

  isConfigured(config: Record<string, unknown>): boolean {
    const key = getTavilyApiKey(config);
    return key.length > 5;
  }

  /**
   * Generates bounded, high-intent queries from the saved operating rules and keywords.
   */
  generateQueries(query: DiscoveryQuery): Array<{ queryText: string; city: string; state: string }> {
    const states = query.states.length > 0 ? query.states : ["TX"];
    const targetStateCode = states[0]?.toUpperCase() || "TX";
    const stateName = STATE_NAMES[targetStateCode] || targetStateCode;

    // Resolve cities
    let targetCities = query.cities.filter(Boolean);
    if (targetCities.length === 0) {
      if (targetStateCode === "TX") targetCities = ["Dallas", "Houston", "Austin", "Fort Worth", "San Antonio"];
      else if (targetStateCode === "FL") targetCities = ["Tampa", "Orlando", "Miami", "Jacksonville"];
      else if (targetStateCode === "GA") targetCities = ["Atlanta", "Marietta", "Savannah", "Alpharetta"];
      else if (targetStateCode === "NC") targetCities = ["Charlotte", "Raleigh", "Durham", "Greensboro"];
      else if (targetStateCode === "OH") targetCities = ["Columbus", "Cincinnati", "Cleveland", "Dayton"];
      else if (targetStateCode === "AZ") targetCities = ["Phoenix", "Tucson", "Mesa", "Scottsdale"];
      else targetCities = ["Dallas", "Houston", "Austin", "Fort Worth"];
    }

    // Dynamic keywords from the active rule
    const kwList = query.keywords.length > 0
      ? query.keywords
      : ["residential HVAC replacement", "HVAC installation financing", "residential AC replacement"];

    const isHvacNiche = kwList.some((k) => /hvac|air conditioning|heating|furnace|ac replacement/i.test(k));

    const queries: Array<{ queryText: string; city: string; state: string }> = [];

    if (isHvacNiche) {
      // Query 1: High-ticket Brand Premier Dealers / Certified in city 1
      const city1 = targetCities[0] || "Dallas";
      const kw1 = kwList[0] || "residential HVAC replacement";
      queries.push({
        queryText: `${kw1} premier dealer OR factory authorized in ${city1}, ${stateName}`,
        city: city1,
        state: targetStateCode,
      });

      // Query 2: High-ticket System Replacement with Financing in city 2
      const city2 = targetCities[1] || targetCities[0] || "Houston";
      const kw2 = kwList[1] || kwList[0] || "HVAC installation";
      queries.push({
        queryText: `${kw2} offering financing in ${city2}, ${stateName}`,
        city: city2,
        state: targetStateCode,
      });

      // Query 3: Local Reviews & Google Presence in city 3
      const city3 = targetCities[2] || targetCities[0] || "Austin";
      const kw3 = kwList[2] || kwList[0] || "residential AC replacement";
      queries.push({
        queryText: `${kw3} contractors reviews ratings in ${city3}, ${stateName}`,
        city: city3,
        state: targetStateCode,
      });

      if (query.limit >= 50 && targetCities.length > 3) {
        const city4 = targetCities[3] || "Fort Worth";
        queries.push({
          queryText: `residential heating and AC replacement companies license in ${city4}, ${stateName}`,
          city: city4,
          state: targetStateCode,
        });

        if (targetCities.length > 4) {
          const city5 = targetCities[4] || "San Antonio";
          queries.push({
            queryText: `residential HVAC contractors new system installation financing in ${city5}, ${stateName}`,
            city: city5,
            state: targetStateCode,
          });
        }
      }
    } else {
      // Multi-niche dynamic queries (Real Estate, Medical, Dental, Solar, Roofing, Legal, Custom)
      const city1 = targetCities[0] || "Dallas";
      const kw1 = kwList[0] || "local business";
      queries.push({
        queryText: `${kw1} official website contact team in ${city1}, ${stateName}`,
        city: city1,
        state: targetStateCode,
      });

      const city2 = targetCities[1] || targetCities[0] || "Houston";
      const kw2 = kwList[1] || kw1;
      queries.push({
        queryText: `top ${kw2} services specialists in ${city2}, ${stateName}`,
        city: city2,
        state: targetStateCode,
      });

      const city3 = targetCities[2] || targetCities[0] || "Austin";
      const kw3 = kwList[2] || kw1;
      queries.push({
        queryText: `${kw3} local reviews ratings in ${city3}, ${stateName}`,
        city: city3,
        state: targetStateCode,
      });

      if (query.limit >= 50 && targetCities.length > 3) {
        const city4 = targetCities[3] || "Fort Worth";
        queries.push({
          queryText: `${kw1} group practice agency in ${city4}, ${stateName}`,
          city: city4,
          state: targetStateCode,
        });

        if (targetCities.length > 4) {
          const city5 = targetCities[4] || "San Antonio";
          queries.push({
            queryText: `${kw2} company in ${city5}, ${stateName}`,
            city: city5,
            state: targetStateCode,
          });
        }
      }
    }

    return queries;
  }

  async discover(query: DiscoveryQuery, config: Record<string, unknown>): Promise<DiscoveredCandidate[]> {
    const apiKey = getTavilyApiKey(config);
    if (!apiKey) {
      throw new Error(
        "Tavily Search API key is not configured. Please set TAVILY_API_KEY in .env.local or configure it in the Sources tab."
      );
    }

    const searchQueries = this.generateQueries(query);
    const candidates: DiscoveredCandidate[] = [];
    const seenDomains = new Set<string>();

    const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/;

    for (const q of searchQueries) {
      if (candidates.length >= query.limit) break;

      try {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            api_key: apiKey,
            query: q.queryText,
            search_depth: "basic",
            max_results: Math.min(Math.max(query.limit, 10), 20),
            exclude_domains: EXCLUDED_AGGREGATOR_DOMAINS,
          }),
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        if (!response.ok) {
          const errText = await response.text();
          if (response.status === 401 || response.status === 403) {
            throw new Error(`Tavily API Authentication failed: Invalid or exhausted API key (${response.status}).`);
          }
          if (response.status === 429) {
            throw new Error(`Tavily API Rate Limit / Credit Quota Exceeded (429).`);
          }
          throw new Error(`Tavily API returned HTTP ${response.status}: ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        const results = data.results || [];

        for (const item of results) {
          if (candidates.length >= query.limit) break;
          if (!item.url || typeof item.url !== "string") continue;

          // Normalize website URL and domain
          const websiteNorm = normalizeWebsite(item.url);
          if (!websiteNorm.ok) continue;

          const domain = websiteNorm.value.domain.toLowerCase();
          if (seenDomains.has(domain)) continue;

          // Exclude known aggregators
          const isAggregator = EXCLUDED_AGGREGATOR_DOMAINS.some(
            (agg) => domain === agg || domain.endsWith(`.${agg}`)
          );
          if (isAggregator) continue;

          seenDomains.add(domain);

          // Extract clean company name from title
          let rawTitle = typeof item.title === "string" ? item.title : domain;
          let cleanName = rawTitle.split(/[-–—|:]/)[0]?.trim() || domain;
          cleanName = cleanName.replace(/\b(in|near|for|serving)\s+.*$/i, "").trim();
          if (cleanName.length < 2) {
            cleanName = domain.split(".")[0]?.replace(/[-_]/g, " ") || "HVAC Contractor";
            cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
          }

          // Extract published phone number if present in snippet
          let phone: string | null = null;
          let street: string | null = null;
          if (item.content && typeof item.content === "string") {
            const match = item.content.match(phoneRegex);
            if (match) {
              const pNorm = normalizeUsPhone(match[0]);
              if (pNorm) phone = pNorm.display;
            }

            const addrMatch = item.content.match(/\b(\d{1,5}\s+[A-Za-z0-9.\s]{2,25}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Pkwy|Parkway|Hwy|Highway))\b/i);
            if (addrMatch && addrMatch[1]) {
              street = addrMatch[1].trim();
            }
          }

          candidates.push({
            name: cleanName,
            website: websiteNorm.value.url,
            phone,
            street,
            city: q.city,
            state: q.state,
            zip: null,
            provider: "tavily_search",
            providerRef: `tavily_${domain}`,
            sourceUrl: item.url,
            rawPayload: {
              title: item.title,
              url: item.url,
              content: item.content,
              score: item.score,
              query: q.queryText,
            },
          });
        }
      } catch (err: any) {
        // If it's a fatal key/quota error, bubble up so runner updates source status
        if (err.message?.includes("Authentication") || err.message?.includes("Quota")) {
          throw err;
        }
        // Otherwise continue to next query
        console.warn(`Tavily query failed for "${q.queryText}":`, err.message);
      }
    }

    return candidates;
  }
}
