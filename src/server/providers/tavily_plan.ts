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
  UT: ["Salt Lake City", "Provo", "Ogden", "St. George", "Park City", "Moab"],
  SC: ["Charleston", "Columbia", "Greenville", "Myrtle Beach", "Hilton Head Island"],
};

const EXTRA_STATE_CITIES: Record<string, string[]> = {
  TX: ["Frisco", "McKinney", "Irving", "Galveston", "Fredericksburg", "New Braunfels", "Corpus Christi", "Katy", "Sugar Land", "The Woodlands"],
  FL: ["Destin", "Kissimmee", "Sarasota", "Clearwater", "West Palm Beach", "Boca Raton", "Key West", "Fort Myers", "Panama City Beach"],
  GA: ["Sandy Springs", "Athens", "Blue Ridge"],
  NC: ["Asheville", "Boone", "Outer Banks"],
  AZ: ["Sedona", "Tempe", "Peoria", "Flagstaff"],
  CA: ["Palm Springs", "Santa Barbara", "Newport Beach", "Anaheim"],
  CO: ["Breckenridge", "Vail", "Aspen", "Steamboat Springs"],
  TN: ["Gatlinburg", "Pigeon Forge", "Sevierville", "Brentwood"],
};
for (const [st, extra] of Object.entries(EXTRA_STATE_CITIES)) {
  STATE_CITIES[st] = Array.from(new Set([...(STATE_CITIES[st] || []), ...extra]));
}

const CITY_TO_STATE: Record<string, string> = {};
for (const [st, cities] of Object.entries(STATE_CITIES)) {
  for (const c of cities) {
    CITY_TO_STATE[c.toLowerCase()] = st;
  }
}

const DEFAULT_TEMPLATES: Array<(kw: string, city: string, stateName: string) => string> = [
  (kw, city, st) => `${kw} in ${city}, ${st}`,
  (kw, city, st) => `${kw} company official website phone number ${city} ${st}`,
  (kw, city, st) => `${kw} ${city} ${st} "contact us" OR "meet our team"`,
  (kw, city, st) => `${kw} ${city} ${st} "about us" OR "leadership" phone`,
  (kw, city, st) => `${kw} local business ${city} ${st} official website`,
  (kw, city, st) => `${kw} specialists office location ${city} ${st}`,
];

const STR_AIRBNB_TEMPLATES: Array<(kw: string, city: string, stateName: string) => string> = [
  (kw, city, st) => `${kw} in ${city}, ${st} "property management" OR "owners"`,
  (kw, city, st) => `"vacation rental management" ${city} ${st} "properties" OR "homes" contact`,
  (kw, city, st) => `"short term rental management" ${city} ${st} "full service" OR "concierge" phone`,
  (kw, city, st) => `${kw} ${city} ${st} "owner services" OR "list your property" official website`,
  (kw, city, st) => `${kw} ${city} ${st} "24/7" OR "guest support" OR "concierge" contact us`,
  (kw, city, st) => `vacation home property management company ${city} ${st} "our team" OR "about us"`,
];

const ACTIVE_AIRBNB_HOST_TEMPLATES: Array<(kw: string, city: string, stateName: string) => string> = [
  (kw, city, st) => `${kw} in ${city}, ${st} "book direct" OR "properties" phone`,
  (kw, city, st) => `"vacation rentals" ${city} ${st} "book direct" OR "reservations" contact`,
  (kw, city, st) => `${kw} ${city} ${st} "our properties" OR "featured rentals" OR "homes" phone`,
  (kw, city, st) => `"short term rentals" ${city} ${st} "guest" OR "concierge" OR "check-in" contact`,
  (kw, city, st) => `luxury vacation home rentals ${city} ${st} "contact us" phone number`,
  (kw, city, st) => `${kw} ${city} ${st} "airbnb" OR "vrbo" OR "vacation rental" official website`,
];

const CORPORATE_MTR_TEMPLATES: Array<(kw: string, city: string, stateName: string) => string> = [
  (kw, city, st) => `${kw} in ${city}, ${st} "furnished" OR "corporate housing" phone`,
  (kw, city, st) => `"corporate housing" ${city} ${st} "contact us" OR "inquire" phone`,
  (kw, city, st) => `"furnished apartments" ${city} ${st} "extended stay" OR "relocation" contact`,
  (kw, city, st) => `${kw} ${city} ${st} "monthly rentals" OR "executive housing" OR "30+ days" phone`,
  (kw, city, st) => `corporate housing management company ${city} ${st} official website`,
];

const COMMERCIAL_TEMPLATES: Array<(kw: string, city: string, stateName: string) => string> = [
  (kw, city, st) => `${kw} in ${city}, ${st} "commercial"`,
  (kw, city, st) => `${kw} commercial ${city} ${st} "our team" OR "brokers" OR "advisors" phone`,
  (kw, city, st) => `${kw} ${city} ${st} "commercial" "contact us" official website`,
  (kw, city, st) => `${kw} commercial services ${city} ${st} office phone number`,
  (kw, city, st) => `${kw} ${city} ${st} "tenant representation" OR "commercial leasing" OR "commercial property"`,
];

const RESIDENTIAL_TEMPLATES: Array<(kw: string, city: string, stateName: string) => string> = [
  (kw, city, st) => `${kw} in ${city}, ${st}`,
  (kw, city, st) => `${kw} residential ${city} ${st} "meet our team" OR "about us" phone`,
  (kw, city, st) => `${kw} ${city} ${st} official website contact us`,
  (kw, city, st) => `${kw} residential services ${city} ${st} phone number`,
  (kw, city, st) => `${kw} ${city} ${st} "our agents" OR "our team" OR "owner"`,
];

/** Ordered, deterministic list of search queries for the owner's targeting. */
export function buildQueryPlan(input: {
  keywords: string[];
  states: string[];
  cities: string[];
  businessType?: "residential" | "commercial" | "both";
  subNiche?: string;
  negativeKeywords?: string[];
}): PlannedQuery[] {
  const keywords = input.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 8);
  const kwList = keywords.length > 0 ? keywords : ["local business"];

  const states = (input.states.length > 0 ? input.states : ["TX"]).map((s) => s.trim().toUpperCase());
  const ownerCities = input.cities.map((c) => c.trim()).filter(Boolean);

  const places: Array<{ city: string; state: string }> = [];
  const seenPlace = new Set<string>();

  // 1. Prioritize owner-specified cities, accurately mapped to their true state
  for (const city of ownerCities) {
    const matchedState = CITY_TO_STATE[city.toLowerCase()] || states[0] || "TX";
    const key = `${city.toLowerCase()}|${matchedState}`;
    if (!seenPlace.has(key)) {
      seenPlace.add(key);
      places.push({ city, state: matchedState });
    }
  }

  // 2. Add major cities from targeted states as rotation/expansion
  for (const st of states) {
    const stateCities = STATE_CITIES[st] ?? [];
    for (const city of stateCities) {
      const key = `${city.toLowerCase()}|${st}`;
      if (!seenPlace.has(key)) {
        seenPlace.add(key);
        places.push({ city, state: st });
      }
    }
    if (stateCities.length === 0) {
      const key = `|${st}`;
      if (!seenPlace.has(key)) {
        seenPlace.add(key);
        places.push({ city: "", state: st });
      }
    }
  }

  const joinedKw = kwList.join(" ").toLowerCase();
  const isActiveHostNiche =
    input.subNiche === "airbnb_active_hosts" ||
    /\b(book\s*direct|superhost|cabin\s*and\s*villa|beach\s*house\s*vacation)\b/i.test(joinedKw);
  const isCorporateMtrNiche =
    input.subNiche === "corporate_housing_mtr" ||
    /\b(corporate\s*housing|mid\s*term\s*rental|furnished\s*corporate|travel\s*nurse)\b/i.test(joinedKw);
  const isStrNiche =
    input.subNiche === "airbnb_str_concierge" ||
    input.subNiche === "airbnb_str_vrm" ||
    input.subNiche === "str_cohost_hospitality" ||
    /\b(airbnb|vrbo|vacation\s*rental|short[- ]term\s*rental|co-?host|serviced\s*apartment)\b/i.test(joinedKw);

  const templates = isActiveHostNiche
    ? ACTIVE_AIRBNB_HOST_TEMPLATES
    : isCorporateMtrNiche
    ? CORPORATE_MTR_TEMPLATES
    : isStrNiche
    ? STR_AIRBNB_TEMPLATES
    : input.businessType === "commercial" || input.subNiche === "commercial_re" || input.subNiche === "commercial_real_estate"
    ? COMMERCIAL_TEMPLATES
    : input.businessType === "residential" || input.subNiche === "residential_re" || input.subNiche === "residential_real_estate"
    ? RESIDENTIAL_TEMPLATES
    : DEFAULT_TEMPLATES;

  const plan: PlannedQuery[] = [];
  for (const template of templates) {
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
  /^(home|homepage|welcome|index|official site|official website|contact us|about us|contact|about|us|roster|agents|our agents|meet our agents|team members|leadership|leadership team|meet our team|reviews|realtor reviews|real estate|services|locations|staff|meet the team|our team|customer reviews|client reviews|privacy policy|terms of service|realtor|realtors|broker|brokers|listings|featured listings|search|properties|property|idx)$/i;

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

  // If first segment looks like an article headline or generic label, find brand segment
  let candidate = segments[0]!;
  if ((isEditorialHeadline(candidate) || GENERIC_NAME.test(candidate)) && segments.length > 1) {
    const brandSeg = segments.find((s) => !isEditorialHeadline(s) && !GENERIC_NAME.test(s));
    if (brandSeg) {
      candidate = brandSeg;
    } else {
      const lastSeg = segments[segments.length - 1]!;
      if (!isEditorialHeadline(lastSeg)) {
        candidate = lastSeg;
      }
    }
  }

  if (GENERIC_NAME.test(candidate)) return fromDomain;

  // Strip leading utility phrases
  candidate = candidate.replace(/^(?:Contact\s+Us:?|Contact|Meet our Team:?|Meet the Team:?|Meet\s+|Welcome to)\s+/i, "").trim();

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

/**
 * Strict anti-dump pre-filter for search results:
 * Blocks web design agencies, SEO/marketing firms, software/SaaS vendors, schools/courses,
 * casual 1-room sublets, and user-defined negative keywords unless explicitly searched for.
 */
export function isOffNicheSearchResult(input: {
  title?: string;
  content?: string;
  domain?: string;
  url?: string;
  targetKeyword?: string;
  negativeKeywords?: string[];
  businessType?: "residential" | "commercial" | "both";
}): boolean {
  const kwLower = (input.targetKeyword || "").toLowerCase();
  const titleLower = (input.title || "").toLowerCase();
  const contentLower = (input.content || "").toLowerCase();
  const domainLower = (input.domain || input.url || "").toLowerCase();
  const titleAndDomain = `${titleLower} ${domainLower}`;
  const fullText = `${titleLower} ${domainLower} ${contentLower}`;

  // 1. Check user-specified negative keywords against title and domain
  if (input.negativeKeywords && input.negativeKeywords.length > 0) {
    for (const neg of input.negativeKeywords) {
      const cleanNeg = neg.trim().toLowerCase();
      if (cleanNeg.length >= 3 && titleAndDomain.includes(cleanNeg)) {
        return true;
      }
    }
  }

  // 2. Block Web Design, Digital Marketing, SEO, Software, Logistics, Freight, Moving & Staffing vendors unless targeted
  const userWantsMarketingOrTech =
    /\b(web\s*design|web\s*dev|marketing\s*agency|seo|digital\s*marketing|software|saas|it\s*services|advertising\s*agency|logistics|freight|trucking|moving)\b/i.test(
      kwLower
    );

  if (!userWantsMarketingOrTech) {
    if (
      /webdesign|webdev|digitalmarketing|seoagency|marketingagency|mediagroup|designstudio|creativeagency|softwaresolutions|appdev|itservices|realtorwebsites|realestateschool|logistics|freight|trucking|drayage|supplychain|movers|vanlines|autotransport|courier|warehousing|fulfillment|staffing/i.test(
        domainLower
      )
    ) {
      return true;
    }

    if (
      /\b(web\s*design(?:\s+agency|\s+company|\s+for|\s+services|\s+studio)?|website\s*design|website\s*development|custom\s*websites?\s*for|digital\s*marketing\s*(?:agency|company|services)|seo\s*(?:agency|company|services|experts|for\s+realtors|for\s+real\s+estate|for\s+contractors)|ppc\s*(?:agency|management)|social\s*media\s*marketing\s*agency|branding\s*agency|lead\s*generation\s*(?:agency|company|for)|marketing\s*(?:agency|solutions|company)\s*for\s*(?:realtors|real\s*estate|hvac|contractors|property\s*managers)|idx\s*website|real\s*estate\s*crm|property\s*management\s*software|vacation\s*rental\s*software|real\s*estate\s*school|licensing\s*course|exam\s*prep|virtual\s*assistant\s*company|logistics\s*(?:company|services|solutions|group|management)|freight\s*(?:broker|brokerage|forwarding|forwarder|services|company|shipping|transport)|trucking\s*(?:company|services|dispatch)|drayage|3pl\b|third[- ]party\s*logistics|supply\s*chain\s*(?:management|solutions|company)|cargo\s*(?:shipping|transport)|warehouse\s*(?:distribution|logistics|fulfillment)|courier\s*(?:service|company)|moving\s*(?:company|services|and\s*storage)|local\s*movers|long\s*distance\s*movers|van\s*lines|auto\s*transport|fleet\s*management|staffing\s*(?:agency|firm|company)|recruiting\s*(?:agency|firm)|accounting\s*firm|cpa\s*firm)\b/i.test(
        fullText
      )
    ) {
      return true;
    }
  }

  // 3. When targeting Real Estate / STR / Property Management, reject search results that have zero real estate / housing / rental terms
  const isRealEstateOrStrTarget =
    /\b(real\s*estate|realtor|realty|broker|property\s*management|vacation\s*rental|short[- ]term\s*rental|airbnb|vrbo|co-?host|corporate\s*housing|furnished|multifamily|leasing|cabin|villa|beach\s*house)\b/i.test(
      kwLower
    );

  if (isRealEstateOrStrTarget && fullText.length > 60) {
    const hasAnyRealEstateSignal =
      /\b(real\s*estate|realtors?|realty|broker|brokerage|property|properties|rental|rentals|airbnb|vrbo|host|co-?host|housing|furnished|apartment|apartments|multifamily|condo|townhome|villa|villas|cabin|cabins|chalet|beach\s*house|resort|hospitality|stay|stays|lodging|leasing|tenant|landlord|home|homes|house|houses|cre\b|idx|mls|concierge)\b/i.test(
        fullText
      );
    if (!hasAnyRealEstateSignal) {
      return true;
    }
  }

  // 3. When targeting Airbnb / STR Management, block casual 1-room sublets or cleaning-only gigs
  if (/\b(airbnb|vrbo|vacation\s*rental|short[- ]term\s*rental|co-?host)\b/i.test(kwLower)) {
    if (
      /\b(room\s*for\s*rent|shared\s*room|roommate\s*wanted|sublet\s*my\s*room|how\s*to\s*start\s*an\s*airbnb|airbnb\s*cleaning\s*only)\b/i.test(
        fullText
      )
    ) {
      return true;
    }
  }

  return false;
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
  opts: {
    maxResults?: number;
    seenDomains?: Set<string>;
    excludeDomains?: string[];
    negativeKeywords?: string[];
    businessType?: "residential" | "commercial" | "both";
    timeoutMs?: number;
  } = {},
): Promise<DiscoveredCandidate[]> {
  const seen = opts.seenDomains ?? new Set<string>();

  const dynamicExcludes = Array.from(
    new Set([
      ...EXCLUDED_AGGREGATOR_DOMAINS,
      ...(opts.excludeDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, "")),
    ])
  ).slice(0, 140);

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      api_key: apiKey,
      query: item.queryText,
      search_depth: "basic",
      max_results: Math.min(Math.max(opts.maxResults ?? 10, 1), 20),
      exclude_domains: dynamicExcludes,
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
    if (
      isOffNicheSearchResult({
        title,
        content,
        domain,
        targetKeyword: item.keyword,
        negativeKeywords: opts.negativeKeywords,
        businessType: opts.businessType,
      })
    ) {
      continue;
    }

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
