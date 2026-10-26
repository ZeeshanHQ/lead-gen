/**
 * Normalization helpers. Pure functions, no I/O.
 *
 * Rule: these functions only CLEAN or REJECT input. They never guess, infer,
 * or generate a value (especially phone numbers).
 */

// ---------------------------------------------------------------- phones ----

export interface NormalizedPhone {
  e164: string; // +12145550123
  display: string; // (214) 555-0123
  extension: string | null;
}

/**
 * Normalizes a US/Canada (NANP) phone number that a human or a public page
 * already provided. Returns null if it is not a valid NANP number.
 * Never invents digits.
 */
export function normalizeUsPhone(raw: string | null | undefined): NormalizedPhone | null {
  if (!raw) return null;
  let text = String(raw).trim();
  if (!text) return null;

  let extension: string | null = null;
  const extMatch = text.match(/(?:ext\.?|extension|x|#)\s*(\d{1,6})\s*$/i);
  if (extMatch) {
    extension = extMatch[1] ?? null;
    text = text.slice(0, extMatch.index).trim();
  }

  // Keep only digits; allow a single leading +1 / 1.
  let digits = text.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;

  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  const line = digits.slice(6);

  // NANP rules: area code and exchange cannot start with 0 or 1.
  if (/^[01]/.test(area) || /^[01]/.test(exchange)) return null;
  // N11 service codes (411, 911 ...) are not valid area codes.
  if (area[1] === "1" && area[2] === "1") return null;
  // 555-01XX is reserved for fictional use; 555-0100..0199 can never be a real line.
  if (exchange === "555" && /^01\d\d$/.test(line)) return null;

  return {
    e164: `+1${digits}`,
    display: `(${area}) ${exchange}-${line}`,
    extension,
  };
}

/**
 * Resilient phone cleaner that never drops a user's phone number.
 * First tries standard US NANP; if not matching strict NANP rules,
 * cleans digits and formats so imported spreadsheets preserve phone data.
 */
export function cleanPhone(raw: string | null | undefined): NormalizedPhone | null {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;

  // 1. Try standard US NANP first
  const standard = normalizeUsPhone(text);
  if (standard) return standard;

  // 2. Extract extension if present
  let clean = text;
  let extension: string | null = null;
  const extMatch = clean.match(/(?:ext\.?|extension|x|#)\s*(\d{1,6})\s*$/i);
  if (extMatch) {
    extension = extMatch[1] ?? null;
    clean = clean.slice(0, extMatch.index).trim();
  }

  // 3. Extract digits
  let digits = clean.replace(/\D/g, "");
  if (!digits || digits.length < 7) return null;

  // If 11 digits starting with 1 (US country code)
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  if (digits.length === 10) {
    const area = digits.slice(0, 3);
    const exchange = digits.slice(3, 6);
    const line = digits.slice(6);
    return {
      e164: `+1${digits}`,
      display: `(${area}) ${exchange}-${line}`,
      extension,
    };
  }

  // 11-15 digit international or formatted number
  if (digits.length >= 10 && digits.length <= 15) {
    return {
      e164: `+${digits}`,
      display: clean,
      extension,
    };
  }

  // 7 digits local US number
  if (digits.length === 7) {
    return {
      e164: `+1${digits}`,
      display: `${digits.slice(0, 3)}-${digits.slice(3)}`,
      extension,
    };
  }

  return {
    e164: `+${digits}`,
    display: clean,
    extension,
  };
}

// --------------------------------------------------------------- domains ----

/** Hosts that are directories/social pages/manufacturers, never a local company's own website. */
const NON_COMPANY_HOSTS = new Set([
  // Social media & search
  "facebook.com",
  "m.facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "google.com",
  "maps.google.com",
  "g.page",
  "goo.gl",
  "maps.app.goo.gl",
  "bing.com",
  "linktr.ee",
  "wixsite.com",
  "wordpress.com",

  // Review & Lead Aggregators
  "yelp.com",
  "angi.com",
  "angieslist.com",
  "homeadvisor.com",
  "thumbtack.com",
  "bbb.org",
  "nextdoor.com",
  "yellowpages.com",
  "mapquest.com",
  "superpages.com",
  "expertise.com",
  "porch.com",
  "houzz.com",
  "bark.com",
  "networx.com",
  "birdeye.com",
  "trustpilot.com",
  "consumeraffairs.com",
  "manta.com",
  "chamberofcommerce.com",
  "yellowbot.com",
  "citysearch.com",
  "merchantcircle.com",
  "alignable.com",

  // Real Estate Portals & Marketplaces
  "zillow.com",
  "realtor.com",
  "redfin.com",
  "trulia.com",
  "homes.com",
  "apartments.com",
  "loopnet.com",
  "nar.realtor",
  "crexi.com",
  "commercialexchange.com",
  "rent.com",

  // Equipment Manufacturers (Not local service contractors)
  "lennox.com",
  "carrier.com",
  "trane.com",
  "daikin.com",
  "goodmanmfg.com",
  "york.com",
  "rheem.com",
  "ruud.com",
  "bryant.com",
  "americanstandardair.com",
  "mitsubishicomfort.com",
  "amana-hac.com",

  // Jobs, Wiki & B2B Databases
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "wikipedia.org",
  "reddit.com",
  "quora.com",
  "zoominfo.com",
  "dnb.com",
  "crunchbase.com",
  "opencorporates.com",
  "bizapedia.com",
  "buzzfile.com",
]);

export interface NormalizedWebsite {
  /** https://example.com (origin only, no path/query) */
  url: string;
  /** example.com (lowercased, "www." stripped) */
  domain: string;
}

export type WebsiteNormalization =
  | { ok: true; value: NormalizedWebsite }
  | { ok: false; reason: "empty" | "invalid" | "not_a_company_site" | "ip_or_local" };

export function normalizeWebsite(raw: string | null | undefined): WebsiteNormalization {
  if (!raw || !String(raw).trim()) return { ok: false, reason: "empty" };
  let text = String(raw).trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid" };
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /\s/.test(host)) return { ok: false, reason: "invalid" };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === "localhost" || host.endsWith(".local")) {
    return { ok: false, reason: "ip_or_local" };
  }
  if (!/^[a-z0-9.-]+$/.test(host) && !host.startsWith("xn--") && !host.includes("xn--")) {
    return { ok: false, reason: "invalid" };
  }

  const domain = host.replace(/^www\./, "");
  if (isNonCompanyHost(domain)) return { ok: false, reason: "not_a_company_site" };

  return { ok: true, value: { url: `https://${domain}`, domain } };
}

export function isNonCompanyHost(domain: string): boolean {
  if (NON_COMPANY_HOSTS.has(domain)) return true;
  for (const blocked of NON_COMPANY_HOSTS) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

// ----------------------------------------------------------------- names ----

const LEGAL_SUFFIXES = new Set([
  "llc",
  "l l c",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "llp",
  "lp",
  "pllc",
  "pc",
]);

/**
 * Canonical comparison key for a company name:
 * lowercase, "&"→"and", punctuation removed, legal suffixes dropped.
 * Descriptive words ("heating", "air") are kept on purpose.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
  if (!raw) return "";
  let text = String(raw)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const words = text.split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  text = words.join(" ");
  return text;
}

/** Display-clean: trims and collapses whitespace but keeps the user's casing. */
export function cleanDisplayName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------- addresses ----

const STREET_ABBREVIATIONS: Record<string, string> = {
  street: "st",
  avenue: "ave",
  boulevard: "blvd",
  road: "rd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  circle: "cir",
  highway: "hwy",
  parkway: "pkwy",
  place: "pl",
  suite: "ste",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
};

export function normalizeStreetAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  const words = String(raw)
    .toLowerCase()
    .replace(/[#.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => STREET_ABBREVIATIONS[w] ?? w);
  return words.join(" ");
}

export function normalizeZip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{5})(?:-\d{4})?$/);
  return m ? (m[1] ?? null) : null;
}

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};
export const US_STATE_CODES: string[] = [...new Set(Object.values(US_STATES))].sort();

/** "Texas" / "tx" / "TX" → "TX". Returns null if not a US state. */
export function normalizeUsState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = String(raw).trim().toLowerCase();
  if (!t) return null;
  if (US_STATES[t]) return US_STATES[t]!;
  const upper = t.toUpperCase();
  return US_STATE_CODES.includes(upper) ? upper : null;
}

export function normalizeCity(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
