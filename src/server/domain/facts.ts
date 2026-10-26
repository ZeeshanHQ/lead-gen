/**
 * Fact model: the vocabulary for everything the system claims about a company.
 *
 * Core principle: a value is UNKNOWN until evidence says otherwise. Absence of
 * evidence is never turned into NO.
 */

export const TRI_STATE = ["YES", "NO", "UNKNOWN", "CONFLICTING"] as const;
export type TriState = (typeof TRI_STATE)[number];

/**
 * The three provenance labels. They must never be mixed or blurred in the UI.
 *  - PUBLICLY_VERIFIED: stated verbatim on a public source we can link to.
 *  - RESEARCH_INFERENCE: derived by rules/AI from public evidence; not stated outright.
 *  - HUMAN_CONFIRMED: entered or confirmed by a person at Astraventa
 *    (including the caller after a real conversation).
 */
export const PROVENANCE = ["PUBLICLY_VERIFIED", "RESEARCH_INFERENCE", "HUMAN_CONFIRMED"] as const;
export type Provenance = (typeof PROVENANCE)[number];

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  PUBLICLY_VERIFIED: "Publicly verified",
  RESEARCH_INFERENCE: "Research inference",
  HUMAN_CONFIRMED: "Human confirmed",
};

export const SOURCE_TYPES = [
  "website",
  "directory",
  "government",
  "search",
  "enrichment",
  "places",
  "csv_upload",
  "manual_entry",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Boolean-ish facts (YES / NO / UNKNOWN / CONFLICTING). */
export const TRI_FACT_KEYS = [
  "hvac",
  "website_alive",
  "one_person_operation",
  "residential",
  "commercial",
  "replacement",
  "installation",
  "repair",
  "maintenance",
  "emergency",
  "indoor_air_quality",
  "financing",
  "free_estimates",
  "maintenance_plans",
  "multiple_locations",
  "multiple_service_areas",
  "multiple_technicians",
  "hiring",
  "online_booking",
  "quote_form",
  "established_business",
  "strong_presence",
  "google_ads",
  "zillow_advertiser",
  "bleeding_ads",
  "luxury_high_value",
] as const;
export type TriFactKey = (typeof TRI_FACT_KEYS)[number];

/** Non-boolean facts. */
export const VALUE_FACT_KEYS = [
  "employees",
  "software",
  "reputation",
  "rating",
  "doors_managed",
  "avg_property_value",
  "property_mgmt_software",
] as const;
export type ValueFactKey = (typeof VALUE_FACT_KEYS)[number];

export type FactKey = TriFactKey | ValueFactKey;
export const ALL_FACT_KEYS: readonly FactKey[] = [...TRI_FACT_KEYS, ...VALUE_FACT_KEYS];

export const FACT_LABELS: Record<FactKey, string> = {
  hvac: "HVAC services",
  website_alive: "Website reachable",
  one_person_operation: "One-person operation",
  residential: "Residential",
  commercial: "Commercial",
  replacement: "Replacement",
  installation: "Installation",
  repair: "Repair",
  maintenance: "Maintenance",
  emergency: "Emergency service",
  indoor_air_quality: "Indoor air quality",
  financing: "Financing",
  free_estimates: "Free estimates",
  maintenance_plans: "Maintenance plans",
  multiple_locations: "Multiple locations",
  multiple_service_areas: "Multiple service areas",
  multiple_technicians: "Multiple technicians",
  hiring: "Active hiring",
  online_booking: "Online booking",
  quote_form: "Quote / request form",
  established_business: "Established business",
  strong_presence: "Strong public presence",
  google_ads: "Google Ads active",
  zillow_advertiser: "Zillow Premier Agent / Advertiser",
  bleeding_ads: "Bleeding ad spend (Google/Zillow)",
  luxury_high_value: "High-ticket / luxury properties ($400k+)",
  doors_managed: "Doors / units managed",
  avg_property_value: "Average property value",
  property_mgmt_software: "Property management software",
  employees: "Employees",
  software: "Software",
  reputation: "Reviews / reputation",
  rating: "Rating",
};

export interface FactEntry {
  value: string; // TriState for TRI_FACT_KEYS; free text/range for others; "UNKNOWN" if absent
  /** 0..1 */
  confidence: number;
  provenance: Provenance;
  evidenceId: string | null;
  updatedAt: string; // ISO
}

export type FactMap = Partial<Record<FactKey, FactEntry>>;

export function isTriFactKey(key: string): key is TriFactKey {
  return (TRI_FACT_KEYS as readonly string[]).includes(key);
}
export function isFactKey(key: string): key is FactKey {
  return (ALL_FACT_KEYS as readonly string[]).includes(key);
}

export function factValue(facts: FactMap | null | undefined, key: FactKey): string {
  return facts?.[key]?.value ?? "UNKNOWN";
}

/** Below this a fact is displayed as LOW CONFIDENCE rather than VERIFIED. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

export type FactDisplay = "VERIFIED" | "LOW_CONFIDENCE" | "CONFLICTING" | "UNKNOWN" | "NO";

/** Display state for a tri-state fact following the product's labelling rules. */
export function triFactDisplay(entry: FactEntry | undefined): FactDisplay {
  if (!entry || entry.value === "UNKNOWN") return "UNKNOWN";
  if (entry.value === "CONFLICTING") return "CONFLICTING";
  if (entry.value === "NO") return "NO";
  if (entry.value === "YES") {
    return entry.confidence < LOW_CONFIDENCE_THRESHOLD ? "LOW_CONFIDENCE" : "VERIFIED";
  }
  return "UNKNOWN";
}

// ------------------------------------------------------ employees / software

export interface EmployeeRange {
  min: number;
  max: number;
}

/** "5-50", "5 – 50", "12", "50+" → range. Returns null for anything else (never guesses). */
export function parseEmployeeRange(value: string | null | undefined): EmployeeRange | null {
  if (!value) return null;
  const t = value.trim();
  const range = t.match(/^(\d{1,6})\s*[-–—to]+\s*(\d{1,6})$/i);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    return min <= max ? { min, max } : null;
  }
  const plus = t.match(/^(\d{1,6})\s*\+$/);
  if (plus) return { min: Number(plus[1]), max: Number.MAX_SAFE_INTEGER };
  const single = t.match(/^(\d{1,6})$/);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return null;
}

export const SOFTWARE_KEYS = [
  "servicetitan",
  "jobber",
  "housecall_pro",
  "appfolio",
  "buildium",
  "followupboss",
  "kvcore",
  "other",
] as const;
export type SoftwareKey = (typeof SOFTWARE_KEYS)[number];
export const SOFTWARE_LABELS: Record<SoftwareKey, string> = {
  servicetitan: "ServiceTitan",
  jobber: "Jobber",
  housecall_pro: "Housecall Pro",
  appfolio: "AppFolio",
  buildium: "Buildium",
  followupboss: "Follow Up Boss",
  kvcore: "kvCORE",
  other: "Other",
};

export function parseSoftware(value: string | null | undefined): SoftwareKey[] {
  if (!value || value === "UNKNOWN") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SoftwareKey => (SOFTWARE_KEYS as readonly string[]).includes(s));
}

export function formatSoftware(keys: SoftwareKey[]): string {
  if (keys.length === 0) return "UNKNOWN";
  return [...new Set(keys)].sort().join(",");
}
