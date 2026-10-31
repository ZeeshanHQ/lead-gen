/**
 * Lead Gate: the owner-controlled list of "must-have" fields.
 *
 * A lead that is missing ANY enabled requirement never enters the CRM. The gate
 * is pure and deterministic so it can be unit-tested and reused by discovery,
 * re-evaluation and any future import path.
 */
import { z } from "zod";
import { type ContactInput, isDecisionMaker } from "./contact";
import { isValidPersonName } from "@/server/enrichment/people";

export const GATE_FIELDS = [
  "requirePhone",
  "requireWebsite",
  "requireDecisionMaker",
  "requireEmail",
  "requireLocation",
  "requireDirectPhone",
  "requireBleedingAds",
  "requireHighValueProperty",
] as const;
export type GateField = (typeof GATE_FIELDS)[number];

export const gateSchema = z.object({
  requirePhone: z.boolean(),
  requireWebsite: z.boolean(),
  requireDecisionMaker: z.boolean(),
  requireEmail: z.boolean(),
  requireLocation: z.boolean(),
  requireDirectPhone: z.boolean().optional(),
  requireBleedingAds: z.boolean().optional(),
  requireHighValueProperty: z.boolean().optional(),
  customMustHaves: z.array(z.string()).optional(),
});
export type LeadGate = z.infer<typeof gateSchema>;

export function defaultGate(): LeadGate {
  return {
    requirePhone: true,
    requireWebsite: true,
    requireDecisionMaker: false,
    requireEmail: false,
    requireLocation: false,
    requireDirectPhone: false,
    requireBleedingAds: false,
    requireHighValueProperty: false,
    customMustHaves: [],
  };
}

/** Fills any missing keys so older saved rules keep working. */
export function resolveGate(gate: Partial<LeadGate> | null | undefined): LeadGate {
  const base = defaultGate();
  return {
    ...base,
    ...(gate ?? {}),
    customMustHaves: Array.isArray(gate?.customMustHaves) ? gate.customMustHaves : [],
  };
}

export const GATE_META: Record<
  GateField,
  { label: string; shortLabel: string; missingLabel: string; description: string }
> = {
  requirePhone: {
    label: "Phone number",
    shortLabel: "Phone",
    missingLabel: "no phone number",
    description: "A published, dialable phone number must exist.",
  },
  requireWebsite: {
    label: "Working website",
    shortLabel: "Website",
    missingLabel: "no working website",
    description: "The company needs a live website we could actually open.",
  },
  requireDecisionMaker: {
    label: "Decision-maker name",
    shortLabel: "Decision maker",
    missingLabel: "no decision-maker name",
    description: "An owner, founder, president or manager must be named on the site.",
  },
  requireEmail: {
    label: "Business email",
    shortLabel: "Email",
    missingLabel: "no business email",
    description: "At least one published business email address.",
  },
  requireLocation: {
    label: "City & state",
    shortLabel: "Location",
    missingLabel: "no city/state",
    description: "Both city and state must be known.",
  },
  requireDirectPhone: {
    label: "Direct / Personal Mobile Phone",
    shortLabel: "Direct/Mobile Phone",
    missingLabel: "no direct or mobile decision-maker phone",
    description: "Must have a direct line or personal/mobile number for a decision maker or broker.",
  },
  requireBleedingAds: {
    label: "Bleeding Ads (Google/Zillow)",
    shortLabel: "Bleeding Ads",
    missingLabel: "no active Google Ads or Zillow spending",
    description: "Must have active Google Ads tracking pixels or Zillow Premier Agent presence verified.",
  },
  requireHighValueProperty: {
    label: "High-ticket property deals ($400k+)",
    shortLabel: "$400k+ Property",
    missingLabel: "listing inventory under $400k",
    description: "Average listing or portfolio price must be $400k+.",
  },
};

export interface GateInput {
  phone?: string | null;
  website?: string | null;
  /** false when the site was crawled and found dead; null/undefined when unknown. */
  websiteAlive?: boolean | null;
  city?: string | null;
  state?: string | null;
  contacts: ContactInput[];
  facts?: Record<string, any> | null;
  /** Combined searchable text (company name, notes, services, battlecard, snippet) for customMustHaves verification */
  searchText?: string | null;
}

function normalizeFactRecord(raw: Record<string, any> | null | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object" && "value" in v && v.value !== undefined && v.value !== null) {
      out[k] = String(v.value);
    } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = String(v);
    }
  }
  return out;
}

export interface GateResult {
  passed: boolean;
  /** Field keys that were required but missing. */
  missing: GateField[];
  /** Human-readable reasons, e.g. "no phone number". */
  reasons: string[];
}

export function hasDialableNumber(value: string | null | undefined): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return false;
  // Reject identical dummy numbers like 0000000000 or 1111111111
  if (/^(\d)\1{9}$/.test(national)) return false;
  // Area code and exchange cannot start with 0 or 1
  if (/^[01]/.test(national) || /^[01]/.test(national.slice(3, 4))) return false;
  return true;
}

export function matchesCustomMustHave(
  reqRaw: string,
  factsIn: Record<string, any>,
  contacts: ContactInput[],
  searchText?: string | null
): boolean {
  const facts = normalizeFactRecord(factsIn);
  const req = reqRaw.trim().toLowerCase();
  if (!req) return true;

  const corpus = [
    searchText || "",
    Object.entries(facts)
      .filter(([, v]) => v && v !== "NO" && v !== "UNKNOWN")
      .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
      .join(" "),
    contacts.map((c) => `${c.name || ""} ${c.title || ""} ${c.phoneType || ""}`).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  if (/\b(direct\s*phone|personal\s*(?:phone|number)|mobile\s*(?:phone|number)|cell\s*(?:phone|number))\b/.test(req)) {
    return (
      facts.direct_mobile_found === "YES" ||
      contacts.some(
        (c) =>
          hasDialableNumber(c.phone) &&
          (c.phoneType === "PROFESSIONAL_MOBILE" || c.phoneType === "PUBLISHED_DIRECT")
      )
    );
  }

  if (/\b(airbnb|str|short[- ]term\s*rental|vacation\s*rental|co-?host)\b/.test(req)) {
    return (
      facts.str_vacation_rental === "YES" ||
      /\b(airbnb|vrbo|vacation\s*rental|short[- ]term\s*rental|co-?host|holiday\s*rental|serviced\s*apartment|guest\s*support|guesty|hostaway|hospitable|ownerrez|lodgify)\b/i.test(corpus)
    );
  }

  if (/\b(24\/7|24-7|concierge|after[- ]hours|ai\s*calling|night\s*calls)\b/.test(req)) {
    return (
      facts.after_hours_24_7_need === "YES" ||
      facts.str_vacation_rental === "YES" ||
      facts.emergency === "YES" ||
      /\b(24\/7|concierge|after[- ]hours|guest\s*support|emergency|check-?in|booking|inquiry|inquiries)\b/i.test(corpus)
    );
  }

  if (req === "commercial" || req === "commercial only") {
    return facts.commercial === "YES" && facts.residential !== "YES" || (facts.commercial === "YES" && req === "commercial");
  }

  if (req === "residential" || req === "residential only") {
    return facts.residential === "YES" && facts.commercial !== "YES" || (facts.residential === "YES" && req === "residential");
  }

  // Check if all significant words in req appear in corpus
  const tokens = req.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return true;
  return tokens.every((tok) => corpus.includes(tok));
}

export function evaluateGate(gateIn: Partial<LeadGate> | null | undefined, input: GateInput): GateResult {
  const gate = resolveGate(gateIn);
  const missing: GateField[] = [];
  const extraReasons: string[] = [];
  const f = normalizeFactRecord(input.facts);

  // Hard anti-dump checks when facts are present
  if (f.off_niche_vendor === "YES") {
    extraReasons.push("off-niche B2B vendor / agency (web dev, marketing, or software)");
  }
  if (f.niche_verified === "NO") {
    extraReasons.push("website does not match target ICP niche");
  }
  if (f.casual_host_only === "YES") {
    extraReasons.push("casual single-room / temporary host");
  }

  if (gate.requirePhone) {
    const ok =
      hasDialableNumber(input.phone) || input.contacts.some((c) => hasDialableNumber(c.phone));
    if (!ok) missing.push("requirePhone");
  }

  if (gate.requireWebsite) {
    const ok = Boolean(input.website && input.website.trim()) && input.websiteAlive !== false;
    if (!ok) missing.push("requireWebsite");
  }

  if (gate.requireDecisionMaker) {
    const ok = input.contacts.some(
      (c) => Boolean(c.name && isValidPersonName(c.name)) && isDecisionMaker(c.roleClass)
    );
    if (!ok) missing.push("requireDecisionMaker");
  }

  if (gate.requireEmail) {
    const ok = input.contacts.some((c) => Boolean(c.email && c.email.includes("@")));
    if (!ok) missing.push("requireEmail");
  }

  if (gate.requireLocation) {
    const ok = Boolean(input.city && input.city.trim()) && Boolean(input.state && input.state.trim());
    if (!ok) missing.push("requireLocation");
  }

  if (gate.requireDirectPhone) {
    const ok =
      f.direct_mobile_found === "YES" ||
      input.contacts.some(
        (c) =>
          hasDialableNumber(c.phone) &&
          (c.phoneType === "PROFESSIONAL_MOBILE" || c.phoneType === "PUBLISHED_DIRECT")
      );
    if (!ok) missing.push("requireDirectPhone");
  }

  if (gate.requireBleedingAds) {
    const ok = f.bleeding_ads === "YES" || f.google_ads === "YES" || f.zillow_advertiser === "YES";
    if (!ok) missing.push("requireBleedingAds");
  }

  if (gate.requireHighValueProperty) {
    const ok = f.luxury_high_value === "YES" || f.avg_property_value === "$400k+";
    if (!ok) missing.push("requireHighValueProperty");
  }

  if (gate.customMustHaves && gate.customMustHaves.length > 0 && (Object.keys(f).length > 0 || input.searchText)) {
    for (const req of gate.customMustHaves) {
      if (!matchesCustomMustHave(req, f, input.contacts, input.searchText)) {
        extraReasons.push(`missing custom must-have: "${req}"`);
      }
    }
  }

  const reasons = [...missing.map((m) => GATE_META[m].missingLabel), ...extraReasons];
  return {
    passed: missing.length === 0 && extraReasons.length === 0,
    missing,
    reasons,
  };
}

const OFF_NICHE_VENDOR_LEAD_RE =
  /\b(web\s*(design|development|developer|agency|studio)|digital\s*marketing\s*(agency|company)|seo\s*(agency|company|services)|marketing\s*agency|lead\s*generation\s*agency|advertising\s*agency|branding\s*agency|ppc\s*agency|software\s*development\s*company|app\s*development\s*company|custom\s*software|it\s*managed\s*services|staffing\s*agency)\b/i;

export function passesLeadRowGate(
  lead: {
    name?: string | null;
    website?: string | null;
    city?: string | null;
    state?: string | null;
    status?: string | null;
    phoneDisplay?: string | null;
    icpScore?: number | null;
    hasDecisionMaker?: boolean;
    hasDirectContact?: boolean;
    owner?: { name?: string | null; title?: string | null; verified?: boolean } | null;
    best?: { name?: string | null; phone?: string | null; email?: string | null } | null;
    facts?: Record<string, any> | null;
    researchSummary?: string | null;
  },
  gate: LeadGate,
  ruleConfig?: {
    businessType?: "residential" | "commercial" | "both";
    size?: { minEmployees?: number | null; maxEmployees?: number | null; minDoors?: number | null };
    scoring?: { minScore?: number };
    discovery?: { negativeKeywords?: string[] };
  } | null
): boolean {
  if (!lead || !gate) return true;
  if (lead.status === "DISQUALIFIED" || lead.status === "REJECTED") return false;

  const f: Record<string, any> = lead.facts || {};
  const fv = (k: string): string => {
    const raw = f[k];
    if (!raw) return "UNKNOWN";
    return typeof raw === "object" && raw !== null && "value" in raw ? String(raw.value) : String(raw);
  };

  // Hard anti-dump checks
  if (
    fv("off_niche_vendor") === "YES" ||
    fv("niche_verified") === "NO" ||
    fv("casual_host_only") === "YES" ||
    fv("website_alive") === "NO"
  ) {
    return false;
  }

  const nameAndSite = `${lead.name || ""} ${lead.website || ""}`;
  if (OFF_NICHE_VENDOR_LEAD_RE.test(nameAndSite)) {
    return false;
  }

  if (gate.requirePhone) {
    const phone = String(lead.best?.phone || lead.phoneDisplay || "");
    if (!hasDialableNumber(phone)) return false;
  }
  if (gate.requireWebsite) {
    const web = String(lead.website || "").trim();
    if (!web) return false;
  }
  if (gate.requireDecisionMaker) {
    if (!lead.owner?.name && !lead.hasDecisionMaker && !lead.best?.name) return false;
  }
  if (gate.requireEmail) {
    const em = String(lead.best?.email || "");
    if (!em || !em.includes("@")) return false;
  }
  if (gate.requireLocation) {
    if (!lead.city || !lead.state) return false;
  }
  if (gate.requireDirectPhone) {
    if (!lead.hasDirectContact && fv("direct_mobile_found") !== "YES") return false;
  }
  if (gate.requireBleedingAds) {
    const hasAds =
      fv("bleeding_ads") === "YES" ||
      fv("google_ads") === "YES" ||
      fv("zillow_advertiser") === "YES";
    if (!hasAds) return false;
  }
  if (gate.requireHighValueProperty) {
    const isHigh = fv("luxury_high_value") === "YES" || fv("avg_property_value") === "$400k+";
    if (!isHigh) return false;
  }

  if (gate.customMustHaves && gate.customMustHaves.length > 0) {
    const flatFacts = normalizeFactRecord(f);
    const syntheticContacts: ContactInput[] = lead.best?.name
      ? [
          {
            name: lead.best.name,
            title: lead.owner?.title || null,
            phone: lead.best.phone || lead.phoneDisplay || null,
            phoneType: lead.hasDirectContact ? "PROFESSIONAL_MOBILE" : "COMPANY_MAIN",
            email: lead.best.email || null,
            emailType: lead.best.email ? "PUBLIC_BUSINESS" : "UNKNOWN",
            roleClass: "owner",
            verified: true,
          },
        ]
      : [];
    const searchCorpus = `${lead.name || ""} ${lead.website || ""} ${lead.researchSummary || ""}`;
    for (const req of gate.customMustHaves) {
      if (!matchesCustomMustHave(req, flatFacts, syntheticContacts, searchCorpus)) {
        return false;
      }
    }
  }

  if (ruleConfig) {
    // Enforce Commercial vs Residential polarity when facts are known
    if (ruleConfig.businessType === "commercial") {
      if (fv("commercial") === "NO" || (fv("residential") === "YES" && fv("commercial") !== "YES")) {
        return false;
      }
    } else if (ruleConfig.businessType === "residential") {
      if (fv("residential") === "NO" || (fv("commercial") === "YES" && fv("residential") !== "YES")) {
        return false;
      }
    }

    // Enforce Team Size when employee fact is extracted
    const empRaw = fv("employees");
    if (empRaw && empRaw !== "UNKNOWN") {
      const nums = (empRaw.match(/\d+/g) || []).map(Number);
      if (nums.length > 0) {
        const minEmp = nums[0]!;
        const maxEmp = nums.length > 1 ? nums[1]! : minEmp;
        if (ruleConfig.size?.minEmployees && maxEmp < ruleConfig.size.minEmployees) return false;
        if (ruleConfig.size?.maxEmployees && minEmp > ruleConfig.size.maxEmployees) return false;
      }
    }

    // Enforce Portfolio Size (minDoors) when doors_managed fact is extracted
    if (ruleConfig.size?.minDoors && ruleConfig.size.minDoors > 0) {
      const doorsRaw = fv("doors_managed");
      if (doorsRaw && doorsRaw !== "UNKNOWN") {
        const dNum = Number(doorsRaw.replace(/\D/g, ""));
        if (Number.isFinite(dNum) && dNum > 0 && dNum < ruleConfig.size.minDoors) {
          return false;
        }
      }
    }

    // Enforce negative keywords
    const negs = ruleConfig.discovery?.negativeKeywords || [];
    if (negs.length > 0) {
      const lowerCorpus = `${lead.name || ""} ${lead.website || ""}`.toLowerCase();
      for (const neg of negs) {
        const cleanNeg = neg.trim().toLowerCase();
        if (cleanNeg.length >= 3 && lowerCorpus.includes(cleanNeg)) {
          return false;
        }
      }
    }
  }

  return true;
}
