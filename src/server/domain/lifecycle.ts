/**
 * Lead lifecycle. The engine owns only the early stages; everything from
 * CALLING onward is driven by the human sales team.
 */

export const LIFECYCLE = [
  "DISCOVERED",
  "RESEARCHING",
  "RESEARCHED",
  "NEEDS_REVIEW",
  "APPROVED",
  "SYNCED",
  "CALLING",
  "CONNECTED",
  "PAIN_FOUND",
  "QUALIFIED",
  "MEETING_BOOKED",
  "DISCOVERY",
  "PROPOSAL",
  "PILOT",
  "CLOSED",
  "LOST",
  "NURTURE",
  // Off-path terminal-ish state set by the reviewer.
  "REJECTED",
] as const;
export type LifecycleStatus = (typeof LIFECYCLE)[number];

export const LIFECYCLE_LABEL: Record<LifecycleStatus, string> = {
  DISCOVERED: "Discovered",
  RESEARCHING: "Researching",
  RESEARCHED: "Researched",
  NEEDS_REVIEW: "Needs review",
  APPROVED: "Approved",
  SYNCED: "Synced",
  CALLING: "Calling",
  CONNECTED: "Connected",
  PAIN_FOUND: "Pain found",
  QUALIFIED: "Qualified",
  MEETING_BOOKED: "Meeting booked",
  DISCOVERY: "Discovery",
  PROPOSAL: "Proposal",
  PILOT: "Pilot",
  CLOSED: "Closed",
  LOST: "Lost",
  NURTURE: "Nurture",
  REJECTED: "Rejected",
};

/** Stages the lead engine (software) may move a lead into on its own. */
export const ENGINE_OWNED: readonly LifecycleStatus[] = [
  "DISCOVERED",
  "RESEARCHING",
  "RESEARCHED",
  "NEEDS_REVIEW",
];

/** Stages only a human may set. The engine must never infer these. */
export const HUMAN_ONLY: readonly LifecycleStatus[] = [
  "APPROVED",
  "REJECTED",
  "CALLING",
  "CONNECTED",
  "PAIN_FOUND",
  "QUALIFIED",
  "MEETING_BOOKED",
  "DISCOVERY",
  "PROPOSAL",
  "PILOT",
  "CLOSED",
  "LOST",
  "NURTURE",
];

/** Pre-approval stages: leads in these appear in the Review Queue. */
export const REVIEWABLE: readonly LifecycleStatus[] = [
  "DISCOVERED",
  "RESEARCHING",
  "RESEARCHED",
  "NEEDS_REVIEW",
  "REJECTED",
];

/** Stages at or beyond approval that belong to the sales funnel. */
export const POST_APPROVAL: readonly LifecycleStatus[] = [
  "APPROVED",
  "SYNCED",
  "CALLING",
  "CONNECTED",
  "PAIN_FOUND",
  "QUALIFIED",
  "MEETING_BOOKED",
  "DISCOVERY",
  "PROPOSAL",
  "PILOT",
  "CLOSED",
  "LOST",
  "NURTURE",
];

const TRANSITIONS: Record<LifecycleStatus, readonly LifecycleStatus[]> = {
  DISCOVERED: ["RESEARCHING", "NEEDS_REVIEW", "APPROVED", "REJECTED"],
  RESEARCHING: ["RESEARCHED", "DISCOVERED", "NEEDS_REVIEW"],
  RESEARCHED: ["NEEDS_REVIEW", "RESEARCHING", "APPROVED", "REJECTED"],
  NEEDS_REVIEW: ["RESEARCHING", "APPROVED", "REJECTED"],
  APPROVED: ["SYNCED", "CALLING", "REJECTED", "NEEDS_REVIEW"],
  SYNCED: ["CALLING", "APPROVED", "NURTURE", "LOST"],
  CALLING: ["CONNECTED", "NURTURE", "LOST"],
  CONNECTED: ["PAIN_FOUND", "NURTURE", "LOST"],
  PAIN_FOUND: ["QUALIFIED", "NURTURE", "LOST"],
  QUALIFIED: ["MEETING_BOOKED", "NURTURE", "LOST"],
  MEETING_BOOKED: ["DISCOVERY", "NURTURE", "LOST"],
  DISCOVERY: ["PROPOSAL", "NURTURE", "LOST"],
  PROPOSAL: ["PILOT", "CLOSED", "NURTURE", "LOST"],
  PILOT: ["CLOSED", "NURTURE", "LOST"],
  CLOSED: [],
  LOST: ["NURTURE"],
  NURTURE: ["CALLING", "LOST"],
  REJECTED: ["NEEDS_REVIEW", "RESEARCHING"],
};

export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isLifecycleStatus(v: string): v is LifecycleStatus {
  return (LIFECYCLE as readonly string[]).includes(v);
}

/**
 * THE gate for Google Sheets sync.
 * A lead is eligible only if it reached APPROVED (or later) AND a human approval
 * record exists for it. Rejected / unapproved leads are never eligible.
 */
export function isSyncEligible(input: {
  status: LifecycleStatus;
  hasApprovalRecord: boolean;
}): boolean {
  if (!input.hasApprovalRecord) return false;
  if (!POST_APPROVAL.includes(input.status)) return false;
  // LOST / NURTURE leads are not pushed to the active caller sheet.
  return input.status !== "LOST" && input.status !== "NURTURE" && input.status !== "CLOSED";
}

export function isStale(
  lastVerifiedAt: Date | string | null | undefined,
  staleDays: number,
  now: Date = new Date(),
): boolean {
  if (!lastVerifiedAt) return false; // never verified is reported as "not verified", not stale
  const t = new Date(lastVerifiedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > staleDays * 86_400_000;
}
