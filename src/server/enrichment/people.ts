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
  "workforce", "leadership", "administration", "officers", "advisors", "council",
  "executives", "representatives", "representative", "specialists", "technicians", "installers", "dispatchers",
  "decision", "maker", "makers", "principal", "principals", "employee", "employees",
  "office", "main", "branch", "headquarters", "hq", "desk", "dept", "support", "inquiry", "inquiries",
  "general", "sales", "info", "help", "customer", "client", "clients", "relationship", "focused",
  "journal", "business", "daily", "times", "tribune", "gazette", "herald", "chronicle", "magazine",
  "chairman", "president", "presidents", "past", "coordinator", "coordinated", "finder", "directory",
  "vice", "counsel", "offices", "regional", "communication",

  // Geographic & Public entities
  "united", "states", "america", "usa", "state", "city", "county", "town", "metro", "region",
  "national", "international", "federal", "municipal", "government", "association", "associations",
  "affiliation", "affiliations", "society", "framework", "landscape", "military", "historical",
  "institute", "foundation", "academy", "school", "university", "college", "training", "meeting",

  // Trade & Industry words
  "heating", "cooling", "hvac", "air", "conditioning", "mechanical", "plumbing", "electrical",
  "roofing", "contractor", "contractors", "appliance", "refrigeration", "insulation", "furnace",
  "duct", "ventilation", "builder", "builders", "construction", "remodeling",
  "fence", "fences", "vinyl", "pool", "wood", "aluminum", "gate", "gates", "facilities", "facility", "rehab",

  // Real Estate, Housing & Property Management terms
  "tenant", "tenants", "landlord", "landlords", "resident", "residents", "residence", "residential",
  "commercial", "property", "properties", "home", "homes", "housing", "apartment", "apartments",
  "multifamily", "multi-family", "condo", "condos", "hoa", "unit", "units", "door", "doors",
  "rent", "rents", "rental", "rentals", "leasing", "lease", "leases", "mortgage", "mortgages", "loan", "loans",
  "lending", "lender", "lenders", "financing", "financed", "refinance", "investor", "investors", "investment",
  "investments", "portfolio", "screening", "eviction", "protection", "deposit", "inspection", "inspections",
  "maintenance", "repair", "repairs", "showing", "showings", "occupied", "vacancy", "vacancies",
  "realtor", "realtors", "broker", "brokers", "agent", "agents", "buyer", "buyers", "seller", "sellers",
  "agreement", "agreements", "commitment", "commitments", "contract", "contracts", "closing", "escrow",
  "title", "amenities", "amenity", "community", "communities", "development", "subdivision",
  "luxury", "affordable", "relocation", "relocations", "neighborhood", "listing", "listings", "mls", "featured",
  "short", "term", "long", "term", "white", "label", "collection", "collections", "portal", "portals",
  "single", "family", "families", "insurance", "financial", "reporting", "procurement", "transparency", "personalized",
  "care", "energy", "wealth", "optimizer", "asset", "assets", "portfolio", "accounting", "audit",
  "guarantee", "guarantees", "animal", "animals", "pet", "pets", "spaces", "space", "coworking",
  "deed", "deeds", "oversight", "parking", "managed", "collected", "transactions", "transaction",
  "veteran", "veterans", "living", "ownership", "renters",

  // Web, UI, Navigation, Forms & Blog phrases
  "result", "results", "found", "search", "filter", "submit", "loading", "error", "message",
  "page", "pages", "home", "homepage", "contact", "about", "privacy", "terms", "policy", "disclaimer",
  "copyright", "rights", "reserved", "sitemap", "menu", "navigation", "footer", "header",
  "career", "careers", "jobs", "hiring", "apply", "employment", "openings",
  "faq", "faqs", "frequently", "asked", "question", "questions", "answer", "answers",
  "subscribe", "subscription", "notification", "notifications", "notifcations", "newsletter", "blog", "blogs",
  "article", "articles", "post", "posts", "news", "press", "media", "release", "releases",
  "story", "stories", "guide", "guides", "tips", "resources", "resource", "login",
  "logout", "register", "signup", "signin", "account", "profile", "profiles", "dashboard", "cart", "checkout",
  "forms", "form", "document", "documents", "application", "applications", "calculator", "quote",
  "estimate", "estimates", "quick", "links", "link", "online", "assistance",
  "service", "services", "area", "areas", "location", "locations", "hours", "schedule", "appointment",
  "booking", "book", "calendar", "call", "dial", "phone", "email", "address", "reset", "password",
  "notices", "notice", "feed", "feeds", "twitter", "facebook", "instagram", "tiktok", "youtube", "analytics", "data", "trd",

  // Action & Marketing buzzwords
  "free", "emergency", "specials", "coupons", "discount", "discounts", "discounted", "negotiated", "negotiate",
  "rebates", "pricing", "cost", "costs", "fee", "fees", "rates", "rate", "dollar", "dollars", "value", "values",
  "review", "reviews", "reviewed", "rating", "ratings", "testimonial", "testimonials", "feedback",
  "award", "awards", "accolade", "accolades", "recognition", "recipient", "recipients", "certified", "licensed", "license", "licensing", "bonded", "insured",
  "premier", "quality", "comfort", "expert", "experts", "expertise", "pro", "pros", "professional", "professionals",
  "welcome", "read", "more", "click", "here", "view", "see", "meet", "join", "joins", "follow", "share",
  "work", "with", "us", "get", "know", "me", "you", "our", "your", "my", "we", "who", "what", "how", "why",
  "experience", "experienced", "visionary", "passion", "passionate", "genuine", "connect", "let", "lets",
  "make", "offer", "landmark", "clears", "congress", "common", "consumer", "controlled",
  "showings", "available", "several", "culture", "anytime", "cancel", "understanding", "knowledge",
  "transition", "education", "standards", "standard", "preparedness", "excellence", "utopia",
  "compliance", "guidance", "numbers", "number", "longevity", "benefits", "benefit", "processes", "process",
  "retention", "effortless", "network", "networks", "permitting", "clarity", "guesswork", "vendors", "vendor",
  "shopping", "treatment", "brother", "brothers", "twin", "twins", "doing", "giving", "living", "renting",
  "managing", "saving", "earning", "wondering", "aligned", "alignment", "confidential", "responsive",
  "optional", "dedicated", "oriented", "overview", "highlight", "highlights", "appointed", "caused", "departures",
  "headaches", "headache", "honest", "trusted", "proven", "easy", "effortless", "happiness", "satisfaction",
  "comprehensive", "reports", "current", "owners", "cutting", "edge", "estimated", "performance",
  "feel", "confident", "fewer", "transparent", "effective", "highly", "overlays", "access", "refer", "friend",
  "same", "day", "amazing", "strategic", "truly"
]);

const COMMON_REAL_NAMES = new Set([
  "bill", "don", "bob", "will", "rob", "may", "mark", "art", "ray", "lane",
  "dean", "hope", "joy", "faith", "rose", "crystal", "amber", "penny", "dawn",
  "grace", "chase", "miles", "hunter", "grant", "heath", "mason", "clay", "sterling",
  "price", "cole", "brooks", "quick"
]);

const GRAMMAR_STOPWORDS = new Set([
  "and", "or", "for", "the", "on", "in", "to", "by", "that", "with", "from", "at", "as",
  "into", "onto", "of", "about", "under", "over", "through", "between", "against",
  "without", "before", "after", "is", "are", "all", "was", "were", "than", "self",
  "vs", "versus", "her", "his", "their", "theirs", "its", "him", "them", "law", "legal"
]);

const KNOWN_GEOGRAPHIC_NAMES = new Set([
  "san antonio", "san francisco", "san jose", "san diego", "el paso", "fort worth",
  "new york", "south florida", "north carolina", "los angeles", "las vegas", "central florida",
  "oklahoma texas", "west palm", "palm beach", "austin texas", "dallas fort worth", "dallas texas"
]);

const SUSPICIOUS_SUBSTRINGS = [
  "license", "licensed", "texas", "florida", "arizona", "california",
  "capability", "coordinator", "management", "realtor", "broker", "guarantee",
  "agreement", "commitment", "notification", "question", "service", "screening",
  "eviction", "inspection", "community", "resource", "article", "loan",
  "mortgage", "frequently", "subscribe", "collection", "schedule", "ownership",
  "preparedness", "relocation", "analytics", "maintenance"
];

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

  // Reject symbols that don't belong in human names (allow standard hyphen/apostrophe only in specific formats)
  if (/[@!#$%*+=/\\<>:;_{}\[\]|~`?^&—–…*]/.test(s)) return null;
  if (s.includes("...") || s.includes("--") || s.includes(" vs.") || s.includes(" vs ")) return null;

  // Reject contractions and possessives that belong to sentences/blogs
  if (/(?:'s|’s|'ve|’ve|'m|’m|'re|’re|'d|’d|n't|n’t)\b/i.test(s)) return null;
  if (/\b(?:i'm|i’m|you've|you’ve|we've|we’ve|what's|what’s)\b/i.test(s)) return null;

  // Reject strings containing common phrases
  const fullLower = s.toLowerCase().trim();
  if (KNOWN_GEOGRAPHIC_NAMES.has(fullLower)) return null;

  for (const phrase of [
    "no result", "board of", "united states", "awards &", "awards and",
    "contact us", "about us", "quick links", "quick link", "short term", "faq", "tenant screening",
    "frequently asked", "subscribe to", "common questions", "assistance animals", "housing bill",
    "clears congress", "license", "guarantee", "discounts", "discount", "renting made", "save money",
    "save time", "culture", "giving back", "happy customers", "look up", "reach out"
  ]) {
    if (fullLower.includes(phrase)) return null;
  }

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

  if (tokens.length < 2 || tokens.length > 4) return null;

  // Reject names containing sentence grammar words ("For The", "On", "That", "Clears", etc.)
  for (const token of tokens) {
    const cleanToken = token.toLowerCase().replace(/[^a-z]/g, "");
    if (!cleanToken) continue;
    if (GRAMMAR_STOPWORDS.has(cleanToken)) return null;
    if (ENTITY_AND_JUNK_WORDS.has(cleanToken) && !COMMON_REAL_NAMES.has(cleanToken)) return null;
    
    // Check if token contains suspicious concatenated words like "Agreementcommitment", "Zinnlicensed"
    for (const sub of SUSPICIOUS_SUBSTRINGS) {
      if (cleanToken.length > sub.length && cleanToken.includes(sub)) return null;
    }
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
