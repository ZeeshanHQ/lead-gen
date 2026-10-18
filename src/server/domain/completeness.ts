/**
 * Lead completeness: which pieces of data a lead MUST carry before it can be
 * called "fully qualified". The user chooses the required set in the rule
 * editor. Pure logic, no I/O. Nothing here guesses or fabricates data: a
 * field is either present on the record (with its source) or it is MISSING.
 */
import { type ContactInput, isDecisionMaker, isPrimaryDecisionMaker, isValidEmail } from "./contact";

export const COMPLETENESS_FIELDS = [
  "website",
  "company_phone",
  "address",
  "city",
  "state",
  "zip",
  "owner_name",
  "owner_title",
  "owner_phone",
  "owner_email",
  "company_email",
  "employee_count",
] as const;
export type CompletenessField = (typeof COMPLETENESS_FIELDS)[number];

export const COMPLETENESS_LABEL: Record<CompletenessField, string> = {
  website: "Website",
  company_phone: "Company phone",
  address: "Street address",
  city: "City",
  state: "State",
  zip: "ZIP code",
  owner_name: "CEO / Owner name",
  owner_title: "CEO / Owner title",
  owner_phone: "CEO / Owner own phone",
  owner_email: "CEO / Owner own email",
  company_email: "Any business email",
  employee_count: "Employee count",
};

export interface CompletenessConfig {
  /** Every listed field must be present for a lead to count as complete. */
  requiredFields: CompletenessField[];
  /** The owner/CEO must be a VERIFIED contact (linked to a source), not just a name. */
  requireVerifiedOwner: boolean;
}

export function defaultCompletenessConfig(): CompletenessConfig {
  return {
    requiredFields: [
      "website",
      "company_phone",
      "address",
      "city",
      "state",
      "zip",
      "owner_name",
      "owner_title",
      "company_email",
    ],
    requireVerifiedOwner: true,
  };
}

/** Rules saved before this feature existed have no `completeness` block. */
export function resolveCompleteness(
  cfg: Partial<CompletenessConfig> | null | undefined,
): CompletenessConfig {
  const d = defaultCompletenessConfig();
  return {
    requiredFields: Array.isArray(cfg?.requiredFields)
      ? cfg.requiredFields.filter((f): f is CompletenessField =>
          (COMPLETENESS_FIELDS as readonly string[]).includes(f),
        )
      : d.requiredFields,
    requireVerifiedOwner: cfg?.requireVerifiedOwner ?? d.requireVerifiedOwner,
  };
}

export interface CompletenessInput {
  website: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Raw value of the `employees` fact ("UNKNOWN" / null when absent). */
  employees: string | null;
  contacts: ContactInput[];
}

export interface CompletenessResult {
  complete: boolean;
  /** Required fields that are missing, in config order. */
  missing: CompletenessField[];
  present: CompletenessField[];
  /** 0..100 over the required fields (100 when nothing is required). */
  pct: number;
  /** The contact chosen as the CEO / owner, if any. */
  owner: ContactInput | null;
}

const has = (v: string | null | undefined) => !!v && v.trim() !== "";

function hasPhone(v: string | null | undefined): boolean {
  return has(v) && (v as string).replace(/\D/g, "").length >= 7;
}

/** Best owner/CEO contact: primary role with a name first; verified ones win. */
export function pickOwner(contacts: ContactInput[], requireVerified: boolean): ContactInput | null {
  const primaries = contacts.filter((c) => isPrimaryDecisionMaker(c.roleClass));
  const eligible = requireVerified ? primaries.filter((c) => c.verified) : primaries;
  const score = (c: ContactInput) =>
    (has(c.name) ? 8 : 0) + (c.verified ? 4 : 0) + (has(c.title) ? 2 : 0) + (hasPhone(c.phone) ? 1 : 0);
  return [...eligible].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function checkCompleteness(input: CompletenessInput, cfgIn: Partial<CompletenessConfig> | null | undefined): CompletenessResult {
  const cfg = resolveCompleteness(cfgIn);
  const owner = pickOwner(input.contacts, cfg.requireVerifiedOwner);
  const dms = input.contacts.filter((c) => isDecisionMaker(c.roleClass) && (!cfg.requireVerifiedOwner || c.verified));

  const ok: Record<CompletenessField, boolean> = {
    website: has(input.website),
    company_phone: hasPhone(input.phone),
    address: has(input.address),
    city: has(input.city),
    state: has(input.state),
    zip: has(input.zip),
    owner_name: !!owner && has(owner.name),
    owner_title: !!owner && has(owner.title),
    owner_phone: (owner ? [owner] : dms).some((c) => hasPhone(c.phone)),
    owner_email: (owner ? [owner] : dms).some((c) => !!c.email && isValidEmail(c.email)),
    company_email: input.contacts.some((c) => !!c.email && isValidEmail(c.email)),
    employee_count: has(input.employees) && input.employees!.toUpperCase() !== "UNKNOWN",
  };

  const required = cfg.requiredFields;
  const missing = required.filter((f) => !ok[f]);
  const present = required.filter((f) => ok[f]);
  return {
    complete: missing.length === 0,
    missing,
    present,
    pct: required.length === 0 ? 100 : Math.round((present.length / required.length) * 100),
    owner,
  };
}
