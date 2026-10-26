/**
 * Pure helpers for person names found on the open web / registries.
 * No guessing: they only clean and compare what a source actually states.
 */

const ENTITY_AND_JUNK_WORDS = new Set([
  // Corporate & Legal entities
  "llc", "l.l.c", "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
  "ltd", "limited", "lp", "llp", "pllc", "trust", "holdings", "group", "partners", "partnership",
  "enterprises", "ventures", "associates", "firm", "agency", "solutions", "systems", "technologies",
  "services", "management", "consulting", "properties", "realty", "real", "estate", "brokerage",
  
  // Organization units & titles without human names
  "board", "director", "directors", "committee", "department", "division", "team", "staff", "crew",
  "workforce", "leadership", "management", "administration", "officers", "advisors", "council",
  "executives", "representatives", "representative", "specialists", "technicians", "installers", "dispatchers",
  "decision", "maker", "makers", "principal", "principals",
  
  // Geographic & Public entities
  "united", "states", "america", "usa", "state", "city", "county", "town", "metro", "region",
  "national", "international", "federal", "municipal", "government", "association", "society",
  "institute", "foundation", "academy", "school", "university", "college", "training", "meeting",
  
  // Trade & Industry words
  "heating", "cooling", "hvac", "air", "conditioning", "mechanical", "plumbing", "electrical",
  "roofing", "contractor", "contractors", "appliance", "refrigeration", "insulation", "furnace",
  "duct", "ventilation", "builder", "builders", "construction", "remodeling",
  
  // Web, UI, Navigation & Junk phrases
  "result", "results", "found", "search", "filter", "submit", "loading", "error", "message",
  "page", "home", "homepage", "contact", "about", "privacy", "terms", "policy", "disclaimer",
  "copyright", "rights", "reserved", "sitemap", "menu", "navigation", "footer", "header",
  "career", "careers", "jobs", "hiring", "apply", "employment", "openings",
  
  // Action & Marketing words
  "call", "dial", "phone", "email", "address", "hours", "schedule", "quote", "estimate",
  "free", "emergency", "financing", "specials", "coupons", "discount", "rebates", "pricing",
  "review", "reviews", "rating", "ratings", "testimonial", "testimonials", "feedback",
  "award", "awards", "accolade", "accolades", "recognition", "recipient", "recipients", "certified", "licensed", "bonded", "insured",
  "premier", "quality", "comfort", "expert", "experts", "pro", "pros", "professional", "professionals",
  "welcome", "read", "more", "click", "here", "view", "see", "meet", "join", "follow", "share"
]);

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "md", "phd", "esq"]);
const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof"]);

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c: string) => "Mc" + c.toUpperCase());

/**
 * Validates whether a string represents a legitimate human person name
 * and not an entity, UI artifact, blog heading, or dump string.
 */
export function isValidPersonName(raw: string | null | undefined): boolean {
  return cleanPersonName(raw) !== null;
}

/** "SMITH, JOHN A" -> "John A Smith"; returns null for entities, initials-only or junk. */
export function cleanPersonName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, " ").replace(/[()"]/g, "").trim();
  if (!s || /\d/.test(s)) return null;

  // Reject symbols that don't belong in human names
  if (/[@!#$%*+=/\\<>:;_{}\[\]|~`?^]/.test(s)) return null;

  // Handle "LAST, FIRST MIDDLE" format
  if (s.includes(",")) {
    const [last, first] = s.split(",", 2).map((x) => x.trim());
    if (!last || !first) return null;
    s = `${first} ${last}`;
  }

  // Tokenize and clean honorifics
  let tokens = s.split(" ").filter(Boolean);
  if (tokens.length > 0 && tokens[0] && HONORIFICS.has(tokens[0].toLowerCase().replace(/\./g, ""))) {
    tokens = tokens.slice(1);
  }

  if (tokens.length < 2 || tokens.length > 5) return null;

  // Check multi-word phrase junk
  const fullLower = s.toLowerCase();
  for (const phrase of ["no result", "board of", "united states", "awards &", "awards and", "contact us", "about us"]) {
    if (fullLower.includes(phrase)) return null;
  }

  // Check against entity / junk stopwords
  for (const token of tokens) {
    const cleanToken = token.toLowerCase().replace(/[^a-z]/g, "");
    if (!cleanToken) continue;
    if (ENTITY_AND_JUNK_WORDS.has(cleanToken)) return null;
  }

  // Ensure at least two tokens have more than 1 character (avoid "J D")
  if (tokens.filter((t) => t.replace(/[^a-zA-Z]/g, "").length > 1).length < 2) return null;

  return titleCase(tokens.join(" "));
}

/** Stable identity of a person: first + last token, suffixes dropped. */
export function personKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIXES.has(t));
  if (tokens.length < 2) return null;
  return `${tokens[0]}|${tokens[tokens.length - 1]}`;
}

/** True only for exact conventional patterns: jane@, jdoe@, jane.doe@, janed@ ... */
export function emailBelongsTo(email: string, fullName: string): boolean {
  const local = email.split("@")[0]?.toLowerCase().replace(/[._-]/g, "");
  const key = personKey(fullName);
  if (!local || !key) return false;
  const [first, last] = key.split("|") as [string, string];
  return [first, first + last, first[0] + last, first + last[0]].includes(local) && local.length >= 3;
}

/** Combined "DALLAS, TX 75201" -> parts (TDLR-style fields). */
export function splitCityStateZip(raw: string | null | undefined): { city: string; state: string; zip: string } | null {
  const m = raw?.trim().match(/^(.*?),?\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/);
  return m ? { city: titleCase(m[1]!.trim()), state: m[2]!.toUpperCase(), zip: m[3]! } : null;
}

export { titleCase };
