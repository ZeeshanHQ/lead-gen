import type { DiscoveredCandidate, DiscoveryAdapter, DiscoveryQuery, ProviderMetadata } from "./types";
import { buildQueryPlan, runPlannedQuery, SearchProviderError } from "./tavily_plan";

export const TAVILY_PROVIDER_METADATA: ProviderMetadata = {
  id: "tavily_search",
  name: "Tavily Search API (Real-Time Web Discovery)",
  description: "Real-time AI-optimized web search engine for discovering active business websites, contact details, and local listings across any target niche.",
  category: "search",
  requiresApiKey: true,
  costPerRequestUsd: 0.001,
  attributionNotice: "Search results powered by Tavily Search API (tavily.com).",
  retentionPolicyDays: 90,
};

// Known aggregators and social networks to exclude from direct contractor candidates
export const EXCLUDED_AGGREGATOR_DOMAINS = [
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
  "zillow.com",
  "realtor.com",
  "redfin.com",
  "trulia.com",
  "homes.com",
  "apartments.com",
  "loopnet.com",
  "healthgrades.com",
  "webmd.com",
  "zocdoc.com",
  "vitals.com",
  "manta.com",
  "nextdoor.com",
  "pinterest.com",
  "medium.com",
  "houzz.com",
  "porch.com",
  "trustpilot.com",
  "clutch.co",
  "crunchbase.com",
  "zoominfo.com",
  "dnb.com",
  "buildzoom.com",
  "networx.com",
  "bark.com",
  "birdeye.com",
  "angieslist.com",
  "google.com",
  "bing.com",
  "usnews.com",
  "nerdwallet.com",
  "investopedia.com",
  "energy.gov",
  "lawyers.com",
  "avvo.com",
  "justia.com",
  "findlaw.com",
  "martindale.com",
  "superlawyers.com",
  "psychologytoday.com",
  "ratemds.com",
  "doximity.com",
  "yellowbot.com",
  "citysearch.com",
  "merchantcircle.com",
  "alignable.com",
  "opencorporates.com",
  "bizapedia.com",
  "buzzfile.com",
];

export const STATE_NAMES: Record<string, string> = {
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
  generateQueries(query: DiscoveryQuery): Array<{ queryText: string; city: string; state: string; keyword: string }> {
    const plan = buildQueryPlan({
      keywords: query.keywords,
      states: query.states,
      cities: query.cities,
    });
    if (plan.length === 0) return [];

    // Return enough queries to satisfy the requested limit in 1 parallel batch
    const maxQueries = Math.min(Math.max(Math.ceil((query.limit || 25) / 10), 2), 3);
    const offset = Math.abs(query.queryOffset ?? 0) % plan.length;

    const selected: typeof plan = [];
    for (let i = 0; i < maxQueries; i++) {
      selected.push(plan[(offset + i) % plan.length]!);
    }
    return selected;
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
    // Seed seenDomains with existing database domains so previously acquired leads are NEVER re-added
    const seenDomains = new Set<string>(
      (query.excludeDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, ""))
    );

    // Execute planned queries in parallel batches of 4 to minimize total discovery latency
    const batchSize = 4;
    for (let i = 0; i < searchQueries.length; i += batchSize) {
      if (candidates.length >= query.limit) break;
      const chunk = searchQueries.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        chunk.map((q) =>
          runPlannedQuery(q, apiKey, {
            maxResults: Math.min(Math.max(query.limit, 12), 20),
            seenDomains,
            excludeDomains: query.excludeDomains,
            timeoutMs: 3200,
          })
        )
      );

      for (const res of results) {
        if (res.status === "fulfilled") {
          for (const item of res.value) {
            if (candidates.length >= query.limit) break;
            candidates.push(item);
          }
        } else {
          const err = res.reason;
          if (err instanceof SearchProviderError && err.fatal) {
            throw err;
          }
          if (
            err?.message?.includes("Authentication") ||
            err?.message?.includes("Quota") ||
            err?.message?.includes("rejected")
          ) {
            throw err;
          }
        }
      }
    }

    return candidates;
  }
}
