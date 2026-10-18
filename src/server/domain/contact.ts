/**
 * Contact classification and the BEST AVAILABLE CONTACT algorithm.
 *
 * Nothing here ever creates or guesses a phone number or email: it only ranks
 * values that already exist with a recorded source.
 */

export const PHONE_TYPES = [
  "COMPANY_MAIN",
  "PUBLISHED_DIRECT",
  "PROFESSIONAL_MOBILE",
  "UNKNOWN",
] as const;
export type PhoneType = (typeof PHONE_TYPES)[number];

export const PHONE_TYPE_LABEL: Record<PhoneType, string> = {
  COMPANY_MAIN: "Company / Main Line",
  PUBLISHED_DIRECT: "Published Direct Business Line",
  PROFESSIONAL_MOBILE: "Professional Mobile",
  UNKNOWN: "Unknown",
};

export const EMAIL_TYPES = ["PUBLIC_BUSINESS", "GENERAL", "UNKNOWN"] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

export const ROLE_CLASSES = [
  "owner",
  "president",
  "founder",
  "general_manager",
  "operations_manager",
  "sales_manager",
  "other",
] as const;
export type RoleClass = (typeof ROLE_CLASSES)[number];

export const ROLE_LABEL: Record<RoleClass, string> = {
  owner: "Owner",
  president: "President",
  founder: "Founder",
  general_manager: "General Manager",
  operations_manager: "Operations Manager",
  sales_manager: "Sales Manager",
  other: "Other",
};

const PRIMARY_ROLES: readonly RoleClass[] = ["owner", "president", "founder"];
const SECONDARY_ROLES: readonly RoleClass[] = [
  "general_manager",
  "operations_manager",
  "sales_manager",
];

export function isPrimaryDecisionMaker(role: RoleClass): boolean {
  return PRIMARY_ROLES.includes(role);
}
export function isDecisionMaker(role: RoleClass): boolean {
  return PRIMARY_ROLES.includes(role) || SECONDARY_ROLES.includes(role);
}

/** Deterministic title → role classification. Unknown titles stay "other". */
export function classifyTitle(title: string | null | undefined): RoleClass {
  const t = (title ?? "").toLowerCase();
  if (!t) return "other";
  if (/\b(co-?)?owner\b|\bproprietor\b|managing\s+(member|partner)/.test(t)) return "owner";
  if (/\bpresident\b/.test(t) && !/vice[\s-]+president|\bvp\b/.test(t)) return "president";
  if (/\bfounder\b|\bco-?founder\b/.test(t)) return "founder";
  if (/\bceo\b|chief executive|\bchair(man|woman|person)\b/.test(t)) return "president";
  if (/general\s+manager|\bgm\b/.test(t)) return "general_manager";
  if (/operations?\s+(manager|director)|\bcoo\b|director of operations/.test(t))
    return "operations_manager";
  if (/sales\s+(manager|director)|director of sales|comfort\s+advisor\s+manager/.test(t))
    return "sales_manager";
  return "other";
}

export interface ContactInput {
  id?: string;
  name: string | null;
  title: string | null;
  roleClass: RoleClass;
  email: string | null;
  emailType: EmailType;
  phone: string | null;
  phoneType: PhoneType;
  /** Person is verified as holding this role (from a source we can link to). */
  verified: boolean;
}

export const CONTACT_LABELS = [
  "DIRECT PROFESSIONAL",
  "PROFESSIONAL MOBILE",
  "COMPANY MAIN LINE",
  "PUBLIC BUSINESS EMAIL",
  "GENERAL EMAIL",
  "NOT FOUND",
] as const;
export type ContactLabel = (typeof CONTACT_LABELS)[number];

export type ContactGrade = "A" | "B" | "C" | "D";
export const CONTACT_GRADE_LABEL: Record<ContactGrade, string> = {
  A: "Direct professional contact verified",
  B: "Decision maker verified, company line only",
  C: "Contact uncertain",
  D: "No useful contact",
};

export interface BestContact {
  /** 1..4 per the spec, or null when nothing usable exists. */
  priority: 1 | 2 | 3 | 4 | null;
  label: ContactLabel;
  contactId: string | null;
  name: string | null;
  title: string | null;
  phone: string | null;
  phoneType: PhoneType | null;
  email: string | null;
  companyPhone: string | null;
  grade: ContactGrade;
  reason: string;
}

function hasDirectPhone(c: ContactInput): boolean {
  return !!c.phone && (c.phoneType === "PUBLISHED_DIRECT" || c.phoneType === "PROFESSIONAL_MOBILE");
}

function directLabel(c: ContactInput): ContactLabel {
  return c.phoneType === "PROFESSIONAL_MOBILE" ? "PROFESSIONAL MOBILE" : "DIRECT PROFESSIONAL";
}

/**
 * Priority 1: verified owner/president/founder with a published professional direct number
 * Priority 2: verified GM/operations/sales decision maker with a published professional direct number
 * Priority 3: verified decision-maker business email + the company line
 * Priority 4: company main line
 */
export function pickBestContact(
  contacts: ContactInput[],
  companyPhone: string | null,
): BestContact {
  const verifiedDMs = contacts.filter((c) => c.verified && isDecisionMaker(c.roleClass));

  const base = (over: Partial<BestContact>): BestContact => ({
    priority: null,
    label: "NOT FOUND",
    contactId: null,
    name: null,
    title: null,
    phone: null,
    phoneType: null,
    email: null,
    companyPhone,
    grade: "D",
    reason: "No usable professional contact has been found.",
    ...over,
  });

  const primary = verifiedDMs.find((c) => isPrimaryDecisionMaker(c.roleClass) && hasDirectPhone(c));
  if (primary) {
    return base({
      priority: 1,
      label: directLabel(primary),
      contactId: primary.id ?? null,
      name: primary.name,
      title: primary.title,
      phone: primary.phone,
      phoneType: primary.phoneType,
      email: primary.email,
      grade: "A",
      reason: "Verified owner/president/founder with a published professional direct number.",
    });
  }

  const secondary = verifiedDMs.find((c) => hasDirectPhone(c));
  if (secondary) {
    return base({
      priority: 2,
      label: directLabel(secondary),
      contactId: secondary.id ?? null,
      name: secondary.name,
      title: secondary.title,
      phone: secondary.phone,
      phoneType: secondary.phoneType,
      email: secondary.email,
      grade: "A",
      reason: "Verified manager-level decision maker with a published professional direct number.",
    });
  }

  const emailDm = verifiedDMs.find((c) => c.email && c.emailType === "PUBLIC_BUSINESS");
  if (emailDm && companyPhone) {
    return base({
      priority: 3,
      label: "PUBLIC BUSINESS EMAIL",
      contactId: emailDm.id ?? null,
      name: emailDm.name,
      title: emailDm.title,
      phone: companyPhone,
      phoneType: "COMPANY_MAIN",
      email: emailDm.email,
      grade: "B",
      reason: "Verified decision maker with a public business email; call goes through the company line.",
    });
  }

  if (companyPhone) {
    const dm = verifiedDMs[0];
    return base({
      priority: 4,
      label: "COMPANY MAIN LINE",
      contactId: dm?.id ?? null,
      name: dm?.name ?? null,
      title: dm?.title ?? null,
      phone: companyPhone,
      phoneType: "COMPANY_MAIN",
      email: dm?.email ?? null,
      grade: dm ? "B" : "C",
      reason: dm
        ? "Decision maker verified, direct phone NOT FOUND. Use the company main line."
        : "Only the company main line is available; no verified decision maker.",
    });
  }

  const anyGeneralEmail = contacts.find((c) => c.email);
  if (anyGeneralEmail) {
    return base({
      priority: null,
      label: anyGeneralEmail.emailType === "PUBLIC_BUSINESS" ? "PUBLIC BUSINESS EMAIL" : "GENERAL EMAIL",
      contactId: anyGeneralEmail.id ?? null,
      name: anyGeneralEmail.name,
      title: anyGeneralEmail.title,
      email: anyGeneralEmail.email,
      grade: "C",
      reason: "Only an email address is available; no phone found.",
    });
  }

  return base({});
}

// ----------------------------------------------------------------- emails ----

const GENERIC_LOCAL_PARTS = new Set([
  "info", "contact", "office", "admin", "support", "sales", "service", "services",
  "hello", "help", "mail", "team", "customerservice", "customer.service", "billing",
  "dispatch", "scheduling", "schedule", "estimates", "quotes", "careers", "jobs", "hr",
]);

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/**
 * PUBLIC_BUSINESS: a personal-looking mailbox at the company's own domain.
 * GENERAL: role mailbox (info@, office@) or any non-company domain.
 * Never produces or guesses an address.
 */
export function classifyEmail(email: string | null | undefined, companyDomain: string | null | undefined): EmailType {
  if (!email || !isValidEmail(email)) return "UNKNOWN";
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (!local || !domain) return "UNKNOWN";
  if (GENERIC_LOCAL_PARTS.has(local)) return "GENERAL";
  if (companyDomain && (domain === companyDomain || domain.endsWith(`.${companyDomain}`))) {
    return "PUBLIC_BUSINESS";
  }
  return "GENERAL";
}
