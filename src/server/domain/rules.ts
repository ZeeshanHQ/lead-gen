/**
 * Research rules: configuration schema, defaults, and deterministic evaluation.
 *
 * Evaluation is tri-valued. A requirement we cannot check is UNKNOWN (needs
 * research), never silently PASS and never silently FAIL.
 */
import { z } from "zod";
import {
  type ContactInput,
  isDecisionMaker,
  isPrimaryDecisionMaker,
} from "./contact";
import { COMPLETENESS_FIELDS, defaultCompletenessConfig } from "./completeness";
import { defaultGate, gateSchema } from "./gate";
import {
  type FactKey,
  type FactMap,
  FACT_LABELS,
  factValue,
  parseEmployeeRange,
  parseSoftware,
  SOFTWARE_KEYS,
} from "./facts";
import { normalizeCity, normalizeCompanyName, normalizeUsPhone, normalizeUsState, normalizeWebsite, normalizeZip } from "./normalize";

// ---------------------------------------------------------------- schema ----

export const SERVICE_KEYS = [
  "replacement",
  "installation",
  "repair",
  "maintenance",
  "emergency",
  "indoor_air_quality",
] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export const SIGNAL_KEYS = [
  "financing",
  "free_estimates",
  "maintenance_plans",
  "multiple_locations",
  "multiple_service_areas",
  "multiple_technicians",
  "hiring",
  "online_booking",
  "quote_form",
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

export const SCORE_CATEGORIES = [
  "icp_fit",
  "service_fit",
  "operational_complexity",
  "decision_maker",
  "contactability",
] as const;
export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

export const SCORE_CATEGORY_LABEL: Record<ScoreCategory, string> = {
  icp_fit: "ICP fit",
  service_fit: "High-value service fit",
  operational_complexity: "Operational complexity",
  decision_maker: "Decision-maker availability",
  contactability: "Contactability",
};

/** Signals that earn points. Each belongs to one category (see defaults). */
export const SCORE_SIGNALS = [
  "residential_hvac",
  "replacement_installation",
  "meaningful_size",
  "multiple_technicians",
  "financing",
  "multiple_locations_or_areas",
  "active_hiring",
  "decision_maker_identified",
  "owner_or_president",
  "professional_direct_contact",
  "company_phone_verified",
  "strong_presence",
  "established_business",
  "bleeding_ad_spend",
  "high_volume_doors",
  "high_ticket_property",
] as const;
export type ScoreSignal = (typeof SCORE_SIGNALS)[number];

export const SCORE_SIGNAL_LABEL: Record<ScoreSignal, string> = {
  residential_hvac: "Residential HVAC",
  replacement_installation: "Replacement / installation",
  meaningful_size: "Meaningful company size",
  multiple_technicians: "Multiple technicians / operational team",
  financing: "Financing advertised",
  multiple_locations_or_areas: "Multiple locations / service areas",
  active_hiring: "Active hiring",
  decision_maker_identified: "Decision maker identified",
  owner_or_president: "Owner / president identified",
  professional_direct_contact: "Professional direct contact",
  company_phone_verified: "Company phone verified",
  strong_presence: "Strong public business presence",
  established_business: "Established business",
  bleeding_ad_spend: "Bleeding ad spend (Google Ads / Zillow)",
  high_volume_doors: "High volume (50+ doors managed)",
  high_ticket_property: "High-ticket property ($400k+ avg)",
};

const int = z.number().int();

export const ruleConfigSchema = z.object({
  geography: z.object({
    country: z.string().min(1),
    states: z.array(z.string()),
    cities: z.array(z.string()),
    zips: z.array(z.string()),
    metros: z.array(z.string()),
    customAreas: z.array(z.string()),
    radiusMiles: int.positive().nullable(),
  }),
  businessType: z.enum(["residential", "commercial", "both"]),
  services: z.object({
    /** At least one of these must be YES. */
    requiredAnyOf: z.array(z.enum(SERVICE_KEYS)),
    preferred: z.array(z.enum(SERVICE_KEYS)),
  }),
  size: z.object({
    minEmployees: int.nonnegative().nullable(),
    maxEmployees: int.nonnegative().nullable(),
    minDoors: int.nonnegative().nullable().optional(),
    allowUnknown: z.boolean(),
  }),
  signals: z.object({ preferred: z.array(z.enum(SIGNAL_KEYS)) }),
  contacts: z.object({
    ownerRequired: z.boolean(),
    decisionMakerNameRequired: z.boolean(),
    directPhoneRequired: z.boolean(),
    businessEmailRequired: z.boolean(),
  }),
  /** Data every lead must carry to count as FULLY QUALIFIED (see domain/completeness). */
  completeness: z
    .object({
      requiredFields: z.array(z.enum(COMPLETENESS_FIELDS)),
      requireVerifiedOwner: z.boolean(),
    })
    .default(() => defaultCompletenessConfig()),
  /** Technology is a research SIGNAL only. It never disqualifies a lead. */
  technology: z.object({ track: z.array(z.enum(SOFTWARE_KEYS)) }),
  requirements: z.object({ websiteRequired: z.boolean() }),
  /** Owner-controlled must-haves. A lead missing any enabled one never enters the CRM. */
  gate: gateSchema.default(() => defaultGate()),
  discovery: z.object({
    keywords: z.array(z.string()),
    negativeKeywords: z.array(z.string()).optional(),
    subNiche: z.string().optional(),
    strictNicheMatch: z.boolean().optional(),
    serviceIntents: z.array(z.string()),
    limits: z.object({
      maxCandidates: int.positive(),
      requestsPerSource: int.positive(),
      concurrency: int.min(1).max(20),
      pagesPerCompany: int.min(1).max(50),
      maxCostUsd: z.number().nonnegative(),
      timeoutSeconds: int.min(5).max(300),
      stopOnError: z.boolean(),
    }),
  }),
  scoring: z.object({
    minScore: int.min(0).max(100),
    categoryCaps: z.record(z.enum(SCORE_CATEGORIES), int.min(0).max(100)),
    signalPoints: z.record(z.string(), int.min(0).max(100)),
  }),
});
export type RuleConfig = z.infer<typeof ruleConfigSchema>;

// -------------------------------------------------------------- defaults ----

export const DEFAULT_RULE_NAME = "US Residential HVAC — Call Ready Prospect";

export function defaultHvacRuleConfig(): RuleConfig {
  return {
    geography: {
      country: "United States",
      states: [],
      cities: [],
      zips: [],
      metros: [],
      customAreas: [],
      radiusMiles: null,
    },
    businessType: "residential",
    services: {
      requiredAnyOf: ["replacement", "installation"],
      preferred: ["maintenance"],
    },
    // 5–50 is a SALES FILTER, not an industry definition.
    size: { minEmployees: 5, maxEmployees: 50, allowUnknown: true },
    signals: {
      preferred: ["financing", "free_estimates", "maintenance_plans", "multiple_service_areas"],
    },
    contacts: {
      ownerRequired: false,
      decisionMakerNameRequired: false,
      directPhoneRequired: false,
      businessEmailRequired: false,
    },
    completeness: defaultCompletenessConfig(),
    technology: { track: ["servicetitan", "jobber", "housecall_pro", "other"] },
    requirements: { websiteRequired: true },
    gate: defaultGate(),
    discovery: {
      keywords: [
        "HVAC contractor",
        "HVAC company",
        "AC replacement",
        "HVAC installation",
        "air conditioning replacement",
        "heating installation",
      ],
      serviceIntents: ["replacement", "installation"],
      limits: {
        maxCandidates: 50,
        requestsPerSource: 25,
        concurrency: 2,
        pagesPerCompany: 12,
        maxCostUsd: 2,
        timeoutSeconds: 30,
        stopOnError: false,
      },
    },
    scoring: {
      minScore: 70,
      // Caps sum to 100: ICP 40 + service 20 + ops 15 + DM 15 + contact 10.
      categoryCaps: {
        icp_fit: 40,
        service_fit: 20,
        operational_complexity: 15,
        decision_maker: 15,
        contactability: 10,
      },
      signalPoints: {
        residential_hvac: 15,
        replacement_installation: 20,
        meaningful_size: 10,
        multiple_technicians: 5,
        financing: 5,
        multiple_locations_or_areas: 5,
        active_hiring: 5,
        decision_maker_identified: 10,
        owner_or_president: 5,
        professional_direct_contact: 5,
        company_phone_verified: 5,
        strong_presence: 5,
        established_business: 5,
        bleeding_ad_spend: 15,
        high_volume_doors: 10,
        high_ticket_property: 10,
      },
    },
  };
}

/** Which category each signal feeds. Fixed structure; weights are configurable. */
export const SIGNAL_CATEGORY: Record<ScoreSignal, ScoreCategory> = {
  residential_hvac: "icp_fit",
  meaningful_size: "icp_fit",
  strong_presence: "icp_fit",
  established_business: "icp_fit",
  multiple_technicians: "icp_fit",
  replacement_installation: "service_fit",
  financing: "operational_complexity",
  multiple_locations_or_areas: "operational_complexity",
  active_hiring: "operational_complexity",
  decision_maker_identified: "decision_maker",
  owner_or_president: "decision_maker",
  professional_direct_contact: "contactability",
  company_phone_verified: "contactability",
  bleeding_ad_spend: "icp_fit",
  high_volume_doors: "operational_complexity",
  high_ticket_property: "service_fit",
};

// ------------------------------------------------------------ evaluation ----

export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN";

export interface RuleCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Hard requirement (affects verdict) vs preference (informational). */
  required: boolean;
}

export interface EvalCompany {
  name: string;
  website: string | null;
  state: string | null;
  city: string | null;
  zip: string | null;
  facts: FactMap;
  contacts: ContactInput[];
  /** True once decision-maker research has been attempted (so absence means NOT FOUND). */
  contactResearchDone: boolean;
}

export type Verdict = "PASS" | "FAIL" | "UNVERIFIED";

export interface RuleEvaluation {
  verdict: Verdict;
  checks: RuleCheck[];
  /** Rule settings we cannot evaluate yet — shown to the user so nothing is silently ignored. */
  notEnforced: string[];
}

const yes = (f: FactMap, k: FactKey) => factValue(f, k) === "YES";
const no = (f: FactMap, k: FactKey) => factValue(f, k) === "NO";

function triCheck(
  id: string,
  label: string,
  required: boolean,
  facts: FactMap,
  key: FactKey,
  passDetail: string,
): RuleCheck {
  const v = factValue(facts, key);
  if (v === "YES") return { id, label, status: "PASS", detail: passDetail, required };
  if (v === "NO") return { id, label, status: "FAIL", detail: `${FACT_LABELS[key]}: NO`, required };
  return {
    id,
    label,
    status: "UNKNOWN",
    detail: `${FACT_LABELS[key]}: ${v === "CONFLICTING" ? "CONFLICTING evidence" : "UNKNOWN (not verified)"}`,
    required,
  };
}

export function evaluateRule(company: EvalCompany, rule: RuleConfig): RuleEvaluation {
  const checks: RuleCheck[] = [];
  const notEnforced: string[] = [];
  const f = company.facts;

  // --- Required: website
  if (rule.requirements.websiteRequired) {
    const site = normalizeWebsite(company.website);
    checks.push({
      id: "website",
      label: "Has a website",
      status: site.ok ? "PASS" : "FAIL",
      detail: site.ok ? site.value.domain : "No valid company website",
      required: true,
    });
  }

  // --- Hard negatives
  if (no(f, "website_alive")) {
    checks.push({ id: "website_alive", label: "Website reachable", status: "FAIL", detail: "Website is dead or unreachable", required: true });
  }
  if (yes(f, "one_person_operation")) {
    checks.push({ id: "one_person", label: "Not a one-person operation", status: "FAIL", detail: "Appears to be a one-person / handyman-type operation", required: true });
  }
  if (yes(f, "off_niche_vendor")) {
    checks.push({
      id: "off_niche_vendor",
      label: "Direct niche operator (not B2B vendor/agency)",
      status: "FAIL",
      detail: "Website is a web design, digital marketing, SEO, or software vendor rather than a target prospect",
      required: true,
    });
  }
  if (no(f, "niche_verified")) {
    checks.push({
      id: "niche_verified",
      label: "Matches target ICP niche",
      status: "FAIL",
      detail: "Website content does not match the active niche / ICP keywords",
      required: true,
    });
  }
  if (yes(f, "casual_host_only")) {
    checks.push({
      id: "casual_host_only",
      label: "Professional multi-property operator",
      status: "FAIL",
      detail: "Appears to be a casual 1-room / temporary host rather than a property management operator",
      required: true,
    });
  }
  if (no(f, "hvac") && (rule.services.requiredAnyOf.length > 0 || rule.discovery.keywords.some((k) => /hvac|air conditioning|heating/i.test(k)))) {
    checks.push({ id: "hvac", label: "HVAC services", status: "FAIL", detail: "HVAC services: NO", required: true });
  }

  // --- Business type (strictly enforced when set to residential or commercial)
  if (rule.businessType === "residential") {
    checks.push(triCheck("business_type", "Residential", true, f, "residential", "Residential service evidenced"));
  } else if (rule.businessType === "commercial") {
    checks.push(triCheck("business_type", "Commercial", true, f, "commercial", "Commercial service evidenced"));
  }

  // --- Service signals
  if (rule.services.requiredAnyOf.length > 0) {
    const keys = rule.services.requiredAnyOf as FactKey[];
    const label = `Service: ${keys.map((k) => FACT_LABELS[k]).join(" or ")}`;
    const hit = keys.find((k) => yes(f, k));
    const allNo = keys.every((k) => no(f, k));
    if (hit) {
      checks.push({ id: "services", label, status: "PASS", detail: `${FACT_LABELS[hit]}: YES`, required: true });
    } else if (allNo) {
      checks.push({ id: "services", label, status: "FAIL", detail: "None of the required services offered", required: true });
    } else {
      checks.push({ id: "services", label, status: "UNKNOWN", detail: "Required service not yet verified", required: true });
    }
  }

  // --- Geography
  const g = rule.geography;
  if (g.states.length > 0) {
    const wanted = g.states.map((s) => normalizeUsState(s) ?? s.toUpperCase());
    const st = normalizeUsState(company.state);
    checks.push(
      !st
        ? { id: "state", label: "State in scope", status: "UNKNOWN", detail: "State unknown", required: true }
        : wanted.includes(st)
          ? { id: "state", label: "State in scope", status: "PASS", detail: st, required: true }
          : { id: "state", label: "State in scope", status: "FAIL", detail: `${st} (outside ${wanted.join(", ")})`, required: true },
    );
  }
  if (g.cities.length > 0) {
    const wanted = g.cities.map(normalizeCity);
    const city = normalizeCity(company.city);
    checks.push(
      !city
        ? { id: "city", label: "City in scope", status: "UNKNOWN", detail: "City unknown", required: false }
        : wanted.includes(city)
          ? { id: "city", label: "City in scope", status: "PASS", detail: company.city ?? "", required: false }
          : { id: "city", label: "City in scope", status: "UNKNOWN", detail: `${company.city} (metro area)`, required: false },
    );
  }
  if (g.zips.length > 0) {
    const zip = normalizeZip(company.zip);
    const wanted = g.zips.map((z) => normalizeZip(z) ?? z);
    checks.push(
      !zip
        ? { id: "zip", label: "ZIP in scope", status: "UNKNOWN", detail: "ZIP unknown", required: true }
        : wanted.includes(zip)
          ? { id: "zip", label: "ZIP in scope", status: "PASS", detail: zip, required: true }
          : { id: "zip", label: "ZIP in scope", status: "FAIL", detail: `${zip} is not in the selected ZIPs`, required: true },
    );
  }
  if (g.metros.length > 0) notEnforced.push("Metro areas (needs geocoding; used only to build discovery queries)");
  if (g.customAreas.length > 0) notEnforced.push("Custom areas (used only to build discovery queries)");
  if (g.radiusMiles) notEnforced.push("Radius (needs geocoding; used only by providers that support it)");

  // --- Company size (employees & doors/listings portfolio)
  const { minEmployees, maxEmployees, minDoors, allowUnknown } = rule.size;
  if (minEmployees !== null || maxEmployees !== null) {
    const range = parseEmployeeRange(f.employees?.value);
    const lo = minEmployees ?? 0;
    const hi = maxEmployees ?? Number.MAX_SAFE_INTEGER;
    if (!range) {
      checks.push({
        id: "size",
        label: "Employee range",
        status: allowUnknown ? "UNKNOWN" : "FAIL",
        detail: allowUnknown ? "Employee count UNKNOWN (allowed by rule)" : "Employee count UNKNOWN and the rule does not allow unknown",
        required: !allowUnknown,
      });
    } else if (range.max < lo || range.min > hi) {
      checks.push({ id: "size", label: "Employee range", status: "FAIL", detail: `${f.employees?.value} is outside ${lo}–${maxEmployees ?? "∞"}`, required: true });
    } else {
      checks.push({ id: "size", label: "Employee range", status: "PASS", detail: `${f.employees?.value} within ${lo}–${maxEmployees ?? "∞"}`, required: true });
    }
  }
  if (minDoors && minDoors > 0) {
    const rawDoors = f.doors_managed?.value ? parseInt(f.doors_managed.value, 10) : null;
    if (rawDoors !== null && !Number.isNaN(rawDoors)) {
      if (rawDoors < minDoors) {
        checks.push({
          id: "doors",
          label: "Portfolio / Listings size",
          status: "FAIL",
          detail: `${rawDoors} doors/listings is below minimum ${minDoors}`,
          required: true,
        });
      } else {
        checks.push({
          id: "doors",
          label: "Portfolio / Listings size",
          status: "PASS",
          detail: `${rawDoors}+ doors/listings managed (min ${minDoors})`,
          required: true,
        });
      }
    }
  }

  // --- Contact requirements
  const dms = company.contacts.filter((c) => c.verified && isDecisionMaker(c.roleClass));
  const contactCheck = (id: string, label: string, ok: boolean, detail: string): RuleCheck => ({
    id,
    label,
    status: ok ? "PASS" : company.contactResearchDone ? "FAIL" : "UNKNOWN",
    detail: ok ? detail : company.contactResearchDone ? "NOT FOUND" : "Not researched yet",
    required: true,
  });
  const c = rule.contacts;
  if (c.ownerRequired) {
    const owner = dms.find((d) => isPrimaryDecisionMaker(d.roleClass));
    checks.push(contactCheck("owner", "Owner / president verified", !!owner, owner?.name ?? ""));
  }
  if (c.decisionMakerNameRequired) {
    const dm = dms.find((d) => !!d.name);
    checks.push(contactCheck("dm_name", "Decision-maker name", !!dm, dm?.name ?? ""));
  }
  if (c.directPhoneRequired) {
    const d = company.contacts.find(
      (x) => x.verified && !!x.phone && (x.phoneType === "PUBLISHED_DIRECT" || x.phoneType === "PROFESSIONAL_MOBILE"),
    );
    checks.push(contactCheck("direct_phone", "Professional direct number", !!d, d?.phone ?? ""));
  }
  if (c.businessEmailRequired) {
    const e = company.contacts.find((x) => !!x.email && x.emailType === "PUBLIC_BUSINESS");
    checks.push(contactCheck("email", "Professional business email", !!e, e?.email ?? ""));
  }

  // --- Preferences (informational only)
  for (const s of rule.services.preferred) {
    const v = factValue(f, s as FactKey);
    checks.push({ id: `pref_${s}`, label: `Prefer: ${FACT_LABELS[s as FactKey]}`, status: v === "YES" ? "PASS" : v === "NO" ? "FAIL" : "UNKNOWN", detail: v, required: false });
  }
  for (const s of rule.signals.preferred) {
    const v = factValue(f, s as FactKey);
    checks.push({ id: `pref_${s}`, label: `Prefer: ${FACT_LABELS[s as FactKey]}`, status: v === "YES" ? "PASS" : v === "NO" ? "FAIL" : "UNKNOWN", detail: v, required: false });
  }

  // --- Technology: a signal only. Reported, never affects verdict.
  const sw = parseSoftware(f.software?.value);
  checks.push({
    id: "technology",
    label: "Software (signal only)",
    status: sw.length > 0 ? "PASS" : "UNKNOWN",
    detail: sw.length > 0 ? sw.join(", ") : "Not publicly verified",
    required: false,
  });

  const required = checks.filter((x) => x.required);
  const verdict: Verdict = required.some((x) => x.status === "FAIL")
    ? "FAIL"
    : required.some((x) => x.status === "UNKNOWN")
      ? "UNVERIFIED"
      : "PASS";

  return { verdict, checks, notEnforced };
}

// ------------------------------------------------------------ exclusions ----

export type ExclusionKind = "domain" | "name" | "phone" | "state";
export const EXCLUSION_KINDS: readonly ExclusionKind[] = ["domain", "name", "phone", "state"];

export interface ExclusionRule {
  id: string;
  kind: ExclusionKind;
  /** Stored already-normalized (see normalizeExclusionValue). */
  value: string;
  reason: string | null;
}

export function normalizeExclusionValue(kind: ExclusionKind, raw: string): string | null {
  switch (kind) {
    case "domain": {
      const w = normalizeWebsite(raw);
      return w.ok ? w.value.domain : null;
    }
    case "name": {
      const n = normalizeCompanyName(raw);
      return n || null;
    }
    case "phone":
      return normalizeUsPhone(raw)?.e164 ?? null;
    case "state":
      return normalizeUsState(raw);
  }
}

export function matchExclusion(
  candidate: { name: string; website?: string | null; phone?: string | null; state?: string | null },
  exclusions: ExclusionRule[],
): ExclusionRule | null {
  const site = normalizeWebsite(candidate.website);
  const domain = site.ok ? site.value.domain : null;
  const nameKey = normalizeCompanyName(candidate.name);
  const phone = normalizeUsPhone(candidate.phone)?.e164 ?? null;
  const state = normalizeUsState(candidate.state);
  return (
    exclusions.find(
      (e) =>
        (e.kind === "domain" && domain === e.value) ||
        (e.kind === "name" && nameKey === e.value) ||
        (e.kind === "phone" && phone === e.value) ||
        (e.kind === "state" && state === e.value),
    ) ?? null
  );
}

// ------------------------------------------------------------- scoring ----

export interface ScoreBreakdown {
  totalScore: number;
  icpScore: number;
  researchConfidence: number;
  grade: "A" | "B" | "C" | "D";
  categoryScores: Record<ScoreCategory, { points: number; cap: number }>;
  signalsPresent: ScoreSignal[];
  signalsMissing: ScoreSignal[];
}

export function calculateLeadScore(
  company: EvalCompany,
  rule: RuleConfig,
): ScoreBreakdown {
  const f = company.facts;
  const contacts = company.contacts;
  const caps = rule.scoring.categoryCaps;
  const points = rule.scoring.signalPoints;

  const present: ScoreSignal[] = [];
  const missing: ScoreSignal[] = [];

  const checkSignal = (sig: ScoreSignal, condition: boolean) => {
    if (condition) present.push(sig);
    else missing.push(sig);
  };

  const hasValidSite = Boolean(company.website && !no(f, "website_alive"));
  const isOffNicheOrDisqualified =
    yes(f, "off_niche_vendor") ||
    no(f, "niche_verified") ||
    yes(f, "casual_host_only") ||
    no(f, "website_alive") ||
    yes(f, "one_person_operation") ||
    (rule.businessType === "commercial" && no(f, "commercial")) ||
    (rule.businessType === "residential" && no(f, "residential"));

  const isHvacRule =
    rule.discovery.keywords.length === 0 ||
    rule.discovery.keywords.some((k) => /\b(hvac|air conditioning|heating|furnace|ac replacement)\b/i.test(k));

  const matchesBusinessType =
    rule.businessType === "commercial"
      ? yes(f, "commercial")
      : rule.businessType === "residential"
      ? yes(f, "residential") || yes(f, "str_vacation_rental") || yes(f, "hvac")
      : yes(f, "residential") || yes(f, "commercial") || yes(f, "str_vacation_rental") || yes(f, "niche_verified");

  const rawDoors = f.doors_managed?.value ? parseInt(f.doors_managed.value, 10) : 0;

  checkSignal(
    "residential_hvac",
    !isOffNicheOrDisqualified &&
      (isHvacRule
        ? yes(f, "hvac") && matchesBusinessType
        : (yes(f, "niche_verified") || yes(f, "str_vacation_rental") || matchesBusinessType))
  );
  checkSignal(
    "replacement_installation",
    !isOffNicheOrDisqualified &&
      (isHvacRule
        ? yes(f, "replacement") || yes(f, "installation")
        : yes(f, "str_vacation_rental") ||
          yes(f, "after_hours_24_7_need") ||
          yes(f, "luxury_high_value") ||
          rawDoors >= 10 ||
          yes(f, "niche_verified") ||
          yes(f, "online_booking") ||
          yes(f, "quote_form"))
  );

  const empRange = parseEmployeeRange(f.employees?.value);
  const minTargetEmp = rule.size.minEmployees ?? 3;
  const maxTargetEmp = rule.size.maxEmployees ?? 500;
  const meaningfulEmp = empRange
    ? empRange.max >= minTargetEmp && empRange.min <= maxTargetEmp
    : false;

  checkSignal(
    "meaningful_size",
    !isOffNicheOrDisqualified &&
      (meaningfulEmp ||
        yes(f, "multiple_technicians") ||
        rawDoors >= 10 ||
        contacts.length >= 1 ||
        (!isHvacRule && (yes(f, "niche_verified") || yes(f, "str_vacation_rental"))))
  );
  checkSignal(
    "multiple_technicians",
    !isOffNicheOrDisqualified &&
      (yes(f, "multiple_technicians") ||
        meaningfulEmp ||
        rawDoors >= 10 ||
        (!isHvacRule && (yes(f, "niche_verified") || yes(f, "str_vacation_rental"))))
  );
  checkSignal("financing", !isOffNicheOrDisqualified && (yes(f, "financing") || yes(f, "after_hours_24_7_need")));
  checkSignal(
    "multiple_locations_or_areas",
    !isOffNicheOrDisqualified && (yes(f, "multiple_locations") || yes(f, "multiple_service_areas"))
  );
  checkSignal("active_hiring", !isOffNicheOrDisqualified && yes(f, "hiring"));

  const dmVerified =
    contacts.some((c) => c.verified && isDecisionMaker(c.roleClass)) ||
    contacts.some((c) => Boolean(c.name) && isDecisionMaker(c.roleClass));
  const ownerVerified =
    contacts.some((c) => c.verified && isPrimaryDecisionMaker(c.roleClass)) ||
    contacts.some((c) => Boolean(c.name) && isPrimaryDecisionMaker(c.roleClass));
  checkSignal("decision_maker_identified", !isOffNicheOrDisqualified && dmVerified);
  checkSignal("owner_or_president", !isOffNicheOrDisqualified && ownerVerified);

  const directContact =
    yes(f, "direct_mobile_found") ||
    contacts.some(
      (c) =>
        Boolean(c.phone) ||
        Boolean(c.email) ||
        (c.verified &&
          (c.phoneType === "PUBLISHED_DIRECT" ||
            c.phoneType === "PROFESSIONAL_MOBILE" ||
            c.emailType === "PUBLIC_BUSINESS")),
    );
  checkSignal("professional_direct_contact", !isOffNicheOrDisqualified && directContact);
  checkSignal("company_phone_verified", !isOffNicheOrDisqualified && (yes(f, "website_alive") || hasValidSite));
  checkSignal("strong_presence", !isOffNicheOrDisqualified && (yes(f, "strong_presence") || yes(f, "niche_verified") || hasValidSite));
  checkSignal(
    "established_business",
    !isOffNicheOrDisqualified &&
      (yes(f, "established_business") ||
        meaningfulEmp ||
        (!isHvacRule && hasValidSite && (yes(f, "niche_verified") || yes(f, "str_vacation_rental"))))
  );

  const isBleeding =
    !isOffNicheOrDisqualified &&
    (yes(f, "bleeding_ads") || yes(f, "google_ads") || yes(f, "zillow_advertiser") || yes(f, "after_hours_24_7_need"));
  checkSignal("bleeding_ad_spend", isBleeding);

  const hasAppFolioOrStrPms =
    f.software?.value
      ?.toLowerCase()
      .match(/appfolio|buildium|guesty|hostaway|hospitable|ownerrez|lodgify/) !== null;
  checkSignal(
    "high_volume_doors",
    !isOffNicheOrDisqualified && (rawDoors >= 15 || Boolean(hasAppFolioOrStrPms) || yes(f, "str_vacation_rental"))
  );

  checkSignal(
    "high_ticket_property",
    !isOffNicheOrDisqualified &&
      (yes(f, "luxury_high_value") || f.avg_property_value?.value === "$400k+" || yes(f, "str_vacation_rental"))
  );

  const categoryScores: Record<ScoreCategory, { points: number; cap: number }> = {
    icp_fit: { points: 0, cap: caps.icp_fit },
    service_fit: { points: 0, cap: caps.service_fit },
    operational_complexity: { points: 0, cap: caps.operational_complexity },
    decision_maker: { points: 0, cap: caps.decision_maker },
    contactability: { points: 0, cap: caps.contactability },
  };

  const defaultSignalBonuses: Partial<Record<ScoreSignal, number>> = {
    bleeding_ad_spend: 15,
    high_volume_doors: 10,
    high_ticket_property: 10,
  };

  for (const sig of present) {
    const cat = SIGNAL_CATEGORY[sig];
    const pt = points[sig] ?? defaultSignalBonuses[sig] ?? 0;
    categoryScores[cat].points += pt;
  }

  let totalScore = 0;
  for (const cat of SCORE_CATEGORIES) {
    const capped = Math.min(categoryScores[cat].points, categoryScores[cat].cap);
    categoryScores[cat].points = capped;
    totalScore += capped;
  }

  const evaluatedFacts = Object.values(f).filter(
    (entry) => !!entry && entry.value !== "UNKNOWN",
  );
  let researchConfidence = 0;
  if (evaluatedFacts.length > 0) {
    const sumConf = evaluatedFacts.reduce((sum, e) => sum + (e.confidence || 0.5), 0);
    researchConfidence = Math.round((sumConf / evaluatedFacts.length) * 100);
  }

  let grade: "A" | "B" | "C" | "D" = "D";
  if (totalScore >= 80 && dmVerified) grade = "A";
  else if (totalScore >= 70) grade = "B";
  else if (totalScore >= 50) grade = "C";

  return {
    totalScore,
    icpScore: totalScore,
    researchConfidence,
    grade,
    categoryScores,
    signalsPresent: present,
    signalsMissing: missing,
  };
}
