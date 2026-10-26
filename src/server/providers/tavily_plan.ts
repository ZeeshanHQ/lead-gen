/**
 * Batch-friendly Tavily discovery. The adapter's `discover()` runs everything in
 * one go; this module splits discovery into an ordered plan of single queries so a
 * caller can pull "the next N leads" in small, time-boxed batches with live progress.
 *
 * Everything here is niche-agnostic: the owner's keywords drive the queries.
 */
import { normalizeUsPhone, normalizeWebsite } from "@/server/domain/normalize";
import type { DiscoveredCandidate } from "./types";
import { EXCLUDED_AGGREGATOR_DOMAINS, STATE_NAMES } from "./tavily_adapter";

export interface PlannedQuery {
  queryText: string;
  keyword: string;
  city: string;
  state: string;
}

const STATE_CITIES: Record<string, string[]> = {
  TX: ["Dallas", "Houston", "Austin", "San Antonio", "Fort Worth", "Plano", "El Paso", "Arlington"],
  FL: ["Tampa", "Orlando", "Miami", "Jacksonville", "Fort Lauderdale", "St. Petersburg", "Naples"],
  GA: ["Atlanta", "Marietta", "Savannah", "Alpharetta", "Augusta", "Roswell"],
  NC: ["Charlotte", "Raleigh", "Durham", "Greensboro", "Wilmington", "Cary"],
  OH: ["Columbus", "Cincinnati", "Cleveland", "Dayton", "Toledo", "Akron"],
  AZ: ["Phoenix", "Tucson", "Mesa", "Scottsdale", "Chandler", "Gilbert"],
  CA: ["Los Angeles", "San Diego", "San Jose", "Sacramento", "Irvine", "Fresno"],
  IL: ["Chicago", "Naperville", "Aurora", "Rockford", "Peoria"],
  CO: ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Boulder"],
  PA: ["Philadelphia", "Pittsburgh", "Allentown", "Harrisburg", "Erie"],
  TN: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Franklin"],
  VA: ["Virginia Beach", "Richmond", "Norfolk", "Arlington", "Chesapeake"],
  NY: ["New York", "Buffalo", "Rochester", "Albany", "Syracuse"],
  WA: ["Seattle", "Tacoma", "Spokane", "Bellevue", "Vancouver"],
  NJ: ["Newark", "Jersey City", "Paterson", "Edison", "Trenton"],
  MI: ["Detroit", "Grand Rapids", "Ann Arbor", "Lansing", "Troy"],
  NV: ["Las Vegas", "Henderson", "Reno", "North Las Vegas"],
  UT: ["Salt Lake City", "Provo", "Ogden", "St. George"],
};

const TEMPLATES: Array<(kw: string, city: string, stateName: string) => string> = [
  (kw, city, st) => `${kw} in ${city}, ${st}`,
  (kw, city, st) => `${kw} company official website phone number ${city} ${st}`,
  (kw, city, st) => `${kw} ${city} ${st} contact us meet our team`,
];

/** Ordered, deterministic list of search queries for the owner's targeting. */
export function buildQueryPlan(input: {
  keywords: string[];
  states: string[];
  cities: string[];
}): PlannedQuery[] {
  const keywords = input.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 8);
  const kwList = keywords.length > 0 ? keywords : ["local business"];

  const states = (input.states.length > 0 ? input.states : ["TX"]).map((s) => s.trim().toUpperCase());
  const ownerCities = input.cities.map((c) => c.trim()).filter(Boolean);

  const places: Array<{ city: string; state: string }> = [];
  states.forEach((st, idx) => {
    const cities = idx === 0 && ownerCities.length > 0 ? ownerCities : (STATE_CITIES[st] ?? []);
    if (cities.length === 0) places.push({ city: "", state: st });
    for (const city of cities) places.push({ city, state: st });
  });

  const plan: PlannedQuery[] = [];
  for (const template of TEMPLATES) {
    for (const kw of kwList) {
      for (const place of places) {
        const stateName = STATE_NAMES[place.state] || place.state;
        const where = place.city ? place.city : stateName;
        plan.push({
          queryText: template(kw, where, stateName).replace(/\s+/g, " ").trim(),
          keyword: kw,
          city: place.city,
          state: place.state,
        });
      }
    }
  }
  return plan;
}

const JUNK_PATH = /\/(blog|news|article|articles|post|posts|guide|guides|best|top|directory|category|categories|tag|tags|compare|comparison|review|reviews|answers|questions|forum|wiki|careers|jobs)(\/|-|$)/i;
const LISTICLE_TITLE =
  /\b(top|best)\s+\d+|\b\d+\s+(best|top)\b|^\s*(top|best)\b|\blist of\b|\bdirectory\b|\bnear me\b|\bcompar(e|ison)\b|\bvs\.?\s|\bhow (to|much)\b|\bcost of\b|\bguide\b|\bwhat is\b|\bwhat it means\b|\bwhy (you|hire|choose)\b|\breasons to\b|\btips (for|to)\b|\bsigns (of|you)\b|\bbenefits of\b|\beverything you need\b/i;

const HEADLINE_PATTERNS = [
  /\b(what it means|why you should|why hire|why choose|top reasons|reasons to|how to|things to know|tips for|signs you need|when to replace|is it time|pros and cons|difference between|everything you need|guide to|benefits of|reviews for|complaints about)\b/i,
  /\b(best|top)\s+\d+/i,
  /\?$/,
];

function isEditorialHeadline(text: string): boolean {
  return HEADLINE_PATTERNS.some((p) => p.test(text));
}

const GENERIC_NAME =
  /^(home|homepage|welcome|index|official site|official website|contact us|about us|contact|about|roster|agents|reviews|realtor reviews|real estate|services|locations|staff|meet the team|our team|customer reviews|client reviews|privacy policy|terms of service)$/i;

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function cleanDomainBrand(domain: string): string {
  const base = (domain.split(".")[0] || domain)
    .replace(/^www\./i, "")
    .replace(/[-_]+/g, " ");
  return titleCase(base);
}

export function companyNameFrom(title: string | undefined, domain: string): string {
  const fromDomain = cleanDomainBrand(domain);
  if (!title) return fromDomain;

  // Split by common title separators
  const segments = title
    .split(/\s+[-–—|:•]\s+|[|•]/)
    .map((s) => s.trim().replace(/[®™]/g, "").trim())
    .filter(Boolean);

  if (segments.length === 0) return fromDomain;

  // If first segment looks like an article headline and last segment looks like a brand
  let candidate = segments[0]!;
  if (isEditorialHeadline(candidate) && segments.length > 1) {
    const lastSeg = segments[segments.length - 1]!;
    if (!isEditorialHeadline(lastSeg)) {
      candidate = lastSeg;
    }
  }

  // Strip trailing geo clauses like "in Dallas TX", "near Austin", "serving Houston"
  candidate = candidate.replace(/\b(in|near|for|serving)\s+[A-Z][\w\s,.]*$/i, "").trim();

  // If candidate still looks like an editorial headline or listicle, fallback to domain brand
  if (isEditorialHeadline(candidate)) return fromDomain;

  // Reject URL paths (e.g. "roster/Agents"), pure cities, pure digits, generic buttons
  if (
    candidate.includes("/") ||
    candidate.length < 2 ||
    candidate.length > 55 ||
    GENERIC_NAME.test(candidate) ||
    /^\d/.test(candidate)
  ) {
    return fromDomain;
  }

  return candidate;
}

const PHONE_REGEX = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/;
const ADDRESS_REGEX =
  /\b(\d{1,5}\s+[A-Za-z0-9.\s]{2,25}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Pkwy|Parkway|Hwy|Highway))\b/i;

export class SearchProviderError extends Error {
  constructor(
    message: string,
    public fatal: boolean,
  ) {
    super(message);
    this.name = "SearchProviderError";
  }
}

/** Runs ONE planned query and returns clean, company-owned-website candidates. */
export async function runPlannedQuery(
  item: PlannedQuery,
  apiKey: string,
  opts: { maxResults?: number; seenDomains?: Set<string>; timeoutMs?: number } = {},
): Promise<DiscoveredCandidate[]> {
  const seen = opts.seenDomains ?? new Set<string>();

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      api_key: apiKey,
      query: item.queryText,
      search_depth: "basic",
      max_results: Math.min(Math.max(opts.maxResults ?? 10, 1), 20),
      exclude_domains: EXCLUDED_AGGREGATOR_DOMAINS,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
  });

  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 160);
    if (response.status === 401 || response.status === 403) {
      throw new SearchProviderError("Search provider rejected the API key. Check TAVILY_API_KEY in Vercel.", true);
    }
    if (response.status === 429 || response.status === 432 || response.status === 433) {
      throw new SearchProviderError("Search provider credit/rate limit reached. Top up Tavily or retry later.", true);
    }
    throw new SearchProviderError(`Search provider returned HTTP ${response.status}: ${body}`, false);
  }

  const data = (await response.json()) as { results?: Array<Record<string, unknown>> };
  const out: DiscoveredCandidate[] = [];

  for (const r of data.results ?? []) {
    const url = typeof r.url === "string" ? r.url : "";
    if (!url) continue;
    const title = typeof r.title === "string" ? r.title : undefined;
    const content = typeof r.content === "string" ? r.content : "";

    const site = normalizeWebsite(url);
    if (!site.ok) continue;
    const domain = site.value.domain.toLowerCase();
    if (seen.has(domain)) continue;
    if (/\.(gov|edu|mil)$/.test(domain)) continue;
    if (EXCLUDED_AGGREGATOR_DOMAINS.some((agg) => domain === agg || domain.endsWith(`.${agg}`))) continue;

    let pathname = "/";
    let origin = site.value.url;
    try {
      const parsed = new URL(site.value.url);
      pathname = parsed.pathname;
      origin = parsed.origin;
    } catch {
      // keep normalized url
    }
    if (JUNK_PATH.test(pathname)) continue;
    if (title && LISTICLE_TITLE.test(title)) continue;

    seen.add(domain);

    let phone: string | null = null;
    const phoneMatch = content.match(PHONE_REGEX);
    if (phoneMatch) phone = normalizeUsPhone(phoneMatch[0])?.display ?? null;
    const street = content.match(ADDRESS_REGEX)?.[1]?.trim() ?? null;

    out.push({
      name: companyNameFrom(title, domain),
      website: origin,
      phone,
      street,
      city: item.city || null,
      state: item.state,
      zip: null,
      provider: "tavily_search",
      providerRef: `tavily_${domain}`,
      sourceUrl: url,
      rawPayload: { title, url, query: item.queryText, score: r.score },
    });
  }

  return out;
}
