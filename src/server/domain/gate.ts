/**
 * Lead Gate: the owner-controlled list of "must-have" fields.
 *
 * A lead that is missing ANY enabled requirement never enters the CRM. The gate
 * is pure and deterministic so it can be unit-tested and reused by discovery,
 * re-evaluation and any future import path.
 */
import { z } from "zod";
import { type ContactInput, isDecisionMaker } from "./contact";

export const GATE_FIELDS = [
  "requirePhone",
  "requireWebsite",
  "requireDecisionMaker",
  "requireEmail",
  "requireLocation",
] as const;
export type GateField = (typeof GATE_FIELDS)[number];

export const gateSchema = z.object({
  requirePhone: z.boolean(),
  requireWebsite: z.boolean(),
  requireDecisionMaker: z.boolean(),
  requireEmail: z.boolean(),
  requireLocation: z.boolean(),
});
export type LeadGate = z.infer<typeof gateSchema>;

export function defaultGate(): LeadGate {
  return {
    requirePhone: true,
    requireWebsite: true,
    requireDecisionMaker: false,
    requireEmail: false,
    requireLocation: false,
  };
}

/** Fills any missing keys so older saved rules keep working. */
export function resolveGate(gate: Partial<LeadGate> | null | undefined): LeadGate {
  return { ...defaultGate(), ...(gate ?? {}) };
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
};

export interface GateInput {
  phone?: string | null;
  website?: string | null;
  /** false when the site was crawled and found dead; null/undefined when unknown. */
  websiteAlive?: boolean | null;
  city?: string | null;
  state?: string | null;
  contacts: ContactInput[];
}

export interface GateResult {
  passed: boolean;
  /** Field keys that were required but missing. */
  missing: GateField[];
  /** Human-readable reasons, e.g. "no phone number". */
  reasons: string[];
}

function hasDialableNumber(value: string | null | undefined): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return national.length >= 10;
}

export function evaluateGate(gateIn: Partial<LeadGate> | null | undefined, input: GateInput): GateResult {
  const gate = resolveGate(gateIn);
  const missing: GateField[] = [];

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
    const ok = input.contacts.some((c) => Boolean(c.name && c.name.trim()) && isDecisionMaker(c.roleClass));
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

  return {
    passed: missing.length === 0,
    missing,
    reasons: missing.map((m) => GATE_META[m].missingLabel),
  };
}
