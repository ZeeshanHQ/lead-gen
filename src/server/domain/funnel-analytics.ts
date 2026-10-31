/**
 * Sales funnel analytics engine.
 *
 * Pure functions only (no DB, no React) so the numbers are deterministic and unit
 * testable. The analytics page feeds this raw audit events + CRM leads; the CRM and
 * the funnel agree because both use the definitions in `call-outcomes.ts`.
 *
 * Two levels of measurement are kept strictly separate:
 *  - LEAD level: "how many unique companies reached each stage" (the funnel)
 *  - DIAL level: "how many call attempts ended in each outcome" (rates, timing)
 */

import {
  ALL_OUTCOME_KEYS,
  CALL_STATUS_DEFS,
  deriveCallStatus,
  extractFollowUp,
  isFollowUpOverdue,
  lifecycleDepthFloor,
  outcomeKeyFromEnum,
  parseCallLog,
  parseNoteTimestamp,
  type CallOutcomeKey,
  type CallStatusKey,
  type FunnelDepth,
} from "./call-outcomes";
import {
  CALLER_TIMEZONE,
  US_TZ_GROUPS,
  wallClock,
  zonedDayKey,
  zonedDayLabel,
  zoneForState,
  type UsTimezoneGroup,
} from "./call-time";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface FunnelLead {
  id: string;
  name: string;
  state: string | null;
  status: string;
  notes: string | null;
  icpScore: number | null;
  assignedMemberId: string | null;
  createdAtMs: number | null;
}

export interface FunnelMember {
  id: string;
  name: string;
  email: string;
  title: string;
}

/** A call recorded in the audit log (authoritative timestamp). */
export interface AuditCallInput {
  id: string;
  actor: string;
  companyId: string | null;
  callOutcome: string;
  notes: string;
  createdAtMs: number;
}

export type Timeframe = "ALL" | "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "LAST_30_DAYS";
export type Scope = "ALL" | "UNASSIGNED" | string;

export interface FunnelFilters {
  scope: Scope;
  timeframe: Timeframe;
  nowMs: number;
}

// ---------------------------------------------------------------------------
// Normalised events
// ---------------------------------------------------------------------------

export interface CallEvent {
  id: string;
  companyId: string;
  actor: string;
  memberId: string | null;
  outcome: CallOutcomeKey;
  atMs: number;
  /** "audit" has an exact timestamp. "note" is rebuilt from the notes text (legacy). */
  source: "audit" | "note";
}

function resolveMemberId(
  actor: string,
  members: FunnelMember[],
  fallbackAssigned: string | null
): string | null {
  const a = actor.trim().toLowerCase();
  if (a) {
    const hit = members.find((m) => m.name.toLowerCase() === a || m.email.toLowerCase() === a);
    if (hit) return hit.id;
  }
  return fallbackAssigned;
}

/**
 * Audit events are authoritative. A lead's notes are only used as a fallback for
 * leads that have NO audit events at all (legacy data), which prevents double counting.
 */
export function buildCallEvents(
  leads: FunnelLead[],
  audit: AuditCallInput[],
  members: FunnelMember[],
  nowMs: number
): CallEvent[] {
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const events: CallEvent[] = [];
  const hasAudit = new Set<string>();

  for (const a of audit) {
    if (!a.companyId) continue;
    const lead = leadById.get(a.companyId);
    if (!lead) continue;
    const outcome = outcomeKeyFromEnum(a.callOutcome);
    if (!outcome) continue;
    hasAudit.add(a.companyId);
    events.push({
      id: a.id,
      companyId: a.companyId,
      actor: a.actor,
      memberId: resolveMemberId(a.actor, members, lead.assignedMemberId),
      outcome,
      atMs: a.createdAtMs,
      source: "audit",
    });
  }

  for (const lead of leads) {
    if (hasAudit.has(lead.id)) continue;
    for (const [idx, entry] of parseCallLog(lead.notes).entries()) {
      const ts = parseNoteTimestamp(entry.timestampRaw, nowMs) ?? lead.createdAtMs ?? nowMs;
      events.push({
        id: `${lead.id}#${idx}`,
        companyId: lead.id,
        actor: entry.author || "Caller",
        memberId: resolveMemberId(entry.author, members, lead.assignedMemberId),
        outcome: entry.outcome,
        atMs: ts,
        source: "note",
      });
    }
  }

  return events.sort((a, b) => a.atMs - b.atMs);
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface FunnelLeak {
  key: string;
  label: string;
  count: number;
  /** Outcome / status key whose color should be used for this leak. */
  colorKey: CallStatusKey;
  /** Query value for the CRM deep link (?status=...). */
  crmFilter?: string;
}

export interface FunnelStage {
  id: "POOL" | "DIALED" | "ANSWERED" | "OWNER" | "MEETING";
  label: string;
  description: string;
  count: number;
  pctOfPool: number;
  /** Conversion from the previous stage (100 for the first stage). */
  stepPct: number;
  lost: number;
  leaks: FunnelLeak[];
  hex: string;
}

export interface HourStat {
  hour: number;
  dials: number;
  human: number;
  owner: number;
  meetings: number;
  rate: number;
}

export interface GoldenWindow {
  startHour: number;
  endHour: number;
  dials: number;
  human: number;
  rate: number;
}

export interface DailyPoint {
  dayKey: string;
  dayLabel: string;
  dials: number;
  human: number;
  owner: number;
  meetings: number;
}

export interface CallerRow {
  id: string;
  name: string;
  title: string;
  assignedLeads: number;
  untouchedLeft: number;
  overdueFollowUps: number;
  dials: number;
  human: number;
  owner: number;
  meetings: number;
  noAnswer: number;
  gatekeeper: number;
  notInterested: number;
  pickRate: number;
  ownerRate: number;
  closeRate: number;
  lastCallMs: number | null;
}

export interface TierRow {
  id: "A" | "B" | "C";
  label: string;
  range: string;
  leads: number;
  dialed: number;
  answered: number;
  owner: number;
  meetings: number;
  answerRate: number;
  meetingRate: number;
}

export interface ZoneLeadCount {
  groupId: UsTimezoneGroup["id"];
  total: number;
  untouched: number;
  retry: number;
}

export interface FunnelResult {
  pool: number;
  stages: FunnelStage[];
  outcomeCounts: Record<CallOutcomeKey, number>;
  /** Mutually exclusive: every lead in the pool has exactly one current status. */
  statusCounts: Record<CallStatusKey, number>;
  dial: {
    total: number;
    human: number;
    owner: number;
    meetings: number;
    pickRate: number;
    ownerRate: number;
    closeRate: number;
    dialsPerOwner: number;
    dialsPerMeeting: number;
    avgAttempts: number;
    dialedLeads: number;
  };
  followUps: {
    scheduled: number;
    overdue: number;
    ownerNoNextStep: number;
  };
  attemptLadder: Array<{ attempt: string; dials: number; human: number; owner: number; rate: number }>;
  daily: DailyPoint[];
  timing: {
    prospectHours: HourStat[];
    callerHours: HourStat[];
    prospectDials: number;
    unknownZoneDials: number;
    golden: GoldenWindow | null;
    weakest: GoldenWindow | null;
    confidence: "NONE" | "LOW" | "MEDIUM" | "HIGH";
    zoneLeads: ZoneLeadCount[];
    overallRate: number;
  };
  callers: CallerRow[];
  tiers: TierRow[];
  quality: {
    auditCalls: number;
    legacyNoteCalls: number;
    leadsMissingState: number;
  };
}

const MIN_WINDOW_DIALS = 8;
const BUSINESS_START = 7;
const BUSINESS_END = 19; // exclusive

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function emptyOutcomeCounts(): Record<CallOutcomeKey, number> {
  return Object.fromEntries(ALL_OUTCOME_KEYS.map((k) => [k, 0])) as Record<CallOutcomeKey, number>;
}

function timeframeRange(tf: Timeframe, nowMs: number): { from: number; to: number } | null {
  if (tf === "ALL") return null;
  const todayKey = zonedDayKey(nowMs, CALLER_TIMEZONE);
  const startOfToday = Date.parse(`${todayKey}T00:00:00+05:00`);
  const DAY = 86400000;
  if (tf === "TODAY") return { from: startOfToday, to: Infinity };
  if (tf === "YESTERDAY") return { from: startOfToday - DAY, to: startOfToday };
  if (tf === "LAST_7_DAYS") return { from: startOfToday - 6 * DAY, to: Infinity };
  return { from: startOfToday - 29 * DAY, to: Infinity };
}

function windowFromHours(hours: HourStat[], overallRate: number): {
  best: GoldenWindow | null;
  worst: GoldenWindow | null;
} {
  const K = 6;
  const prior = overallRate > 0 ? overallRate / 100 : 0.3;
  let best: (GoldenWindow & { score: number }) | null = null;
  let worst: (GoldenWindow & { score: number }) | null = null;
  for (let h = BUSINESS_START; h < BUSINESS_END - 1; h++) {
    const a = hours[h]!;
    const b = hours[h + 1]!;
    const dials = a.dials + b.dials;
    if (dials < MIN_WINDOW_DIALS) continue;
    const human = a.human + b.human;
    const score = (human + prior * K) / (dials + K);
    const cand = { startHour: h, endHour: h + 2, dials, human, rate: pct(human, dials), score };
    if (!best || score > best.score) best = cand;
    if (!worst || score < worst.score) worst = cand;
  }
  if (best && worst && best.startHour === worst.startHour) worst = null;
  const strip = (w: (GoldenWindow & { score: number }) | null): GoldenWindow | null =>
    w ? { startHour: w.startHour, endHour: w.endHour, dials: w.dials, human: w.human, rate: w.rate } : null;
  return { best: strip(best), worst: strip(worst) };
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export function computeFunnel(
  allLeads: FunnelLead[],
  events: CallEvent[],
  members: FunnelMember[],
  filters: FunnelFilters
): FunnelResult {
  const { scope, timeframe, nowMs } = filters;
  const range = timeframeRange(timeframe, nowMs);

  const poolLeads = allLeads.filter((l) => {
    if (scope === "ALL") return true;
    if (scope === "UNASSIGNED") return !l.assignedMemberId;
    return l.assignedMemberId === scope;
  });
  const poolIds = new Set(poolLeads.map((l) => l.id));
  const leadById = new Map(allLeads.map((l) => [l.id, l]));

  const inRange = (e: CallEvent) => !range || (e.atMs >= range.from && e.atMs < range.to);
  const scopedEvents = events.filter((e) => poolIds.has(e.companyId) && inRange(e));

  // ---- lead level ---------------------------------------------------------
  const perLead = new Map<
    string,
    { depth: FunnelDepth; attempts: number; last: CallOutcomeKey | null }
  >();
  for (const e of scopedEvents) {
    const cur = perLead.get(e.companyId) ?? { depth: 0 as FunnelDepth, attempts: 0, last: null };
    const d = CALL_STATUS_DEFS[e.outcome].depth;
    cur.depth = Math.max(cur.depth, d) as FunnelDepth;
    cur.attempts += 1;
    cur.last = e.outcome; // events are sorted ascending, so the last write is the newest
    perLead.set(e.companyId, cur);
  }
  if (timeframe === "ALL") {
    for (const l of poolLeads) {
      const floor = lifecycleDepthFloor(l.status);
      if (floor === 0) continue;
      const cur = perLead.get(l.id) ?? { depth: 0 as FunnelDepth, attempts: 0, last: null };
      if (floor > cur.depth) cur.depth = floor;
      perLead.set(l.id, cur);
    }
  }

  const pool = poolLeads.length;
  let dialedLeads = 0;
  let answeredLeads = 0;
  let ownerLeads = 0;
  let meetingLeads = 0;
  const leakNoAnswer = { NO_ANSWER: 0, CALL_COMPLETED: 0, WRONG_NUMBER: 0, other: 0 };
  let gatekeeperOnly = 0;
  let gatekeeperWithFollowUp = 0;
  let ownerDeclined = 0;
  let ownerOpenWithNext = 0;
  let ownerOpenNoNext = 0;

  for (const l of poolLeads) {
    const info = perLead.get(l.id);
    if (!info || info.depth === 0) continue;
    const followUp = extractFollowUp(l.notes);
    if (info.depth >= 1) dialedLeads++;
    if (info.depth >= 2) answeredLeads++;
    if (info.depth >= 3) ownerLeads++;
    if (info.depth >= 4) meetingLeads++;

    if (info.depth === 1) {
      const last = info.last;
      if (last === "NO_ANSWER") leakNoAnswer.NO_ANSWER++;
      else if (last === "CALL_COMPLETED") leakNoAnswer.CALL_COMPLETED++;
      else if (last === "WRONG_NUMBER") leakNoAnswer.WRONG_NUMBER++;
      else leakNoAnswer.other++;
    } else if (info.depth === 2) {
      gatekeeperOnly++;
      if (followUp) gatekeeperWithFollowUp++;
    } else if (info.depth === 3) {
      if (info.last === "NOT_INTERESTED") ownerDeclined++;
      else if (followUp) ownerOpenWithNext++;
      else ownerOpenNoNext++;
    }
  }

  const stage = (
    id: FunnelStage["id"],
    label: string,
    description: string,
    count: number,
    prev: number | null,
    hex: string,
    leaks: FunnelLeak[]
  ): FunnelStage => ({
    id,
    label,
    description,
    count,
    pctOfPool: pct(count, pool),
    stepPct: prev === null ? 100 : pct(count, prev),
    lost: prev === null ? 0 : Math.max(0, prev - count),
    leaks: leaks.filter((x) => x.count > 0),
    hex,
  });

  const stages: FunnelStage[] = [
    stage("POOL", "Leads in CRM", "Every lead in the selected scope.", pool, null, "#71717a", []),
    stage(
      "DIALED",
      "Dialed at least once",
      "Unique leads with one or more logged calls.",
      dialedLeads,
      pool,
      CALL_STATUS_DEFS.NO_ANSWER.hex,
      [
        {
          key: "untouched",
          label: "Not called yet",
          count: pool - dialedLeads,
          colorKey: "UNTOUCHED",
          crmFilter: "UNTOUCHED",
        },
      ]
    ),
    stage(
      "ANSWERED",
      "A human answered",
      "A person picked up (front desk or owner).",
      answeredLeads,
      dialedLeads,
      CALL_STATUS_DEFS.GATEKEEPER_BLOCKED.hex,
      [
        {
          key: "na",
          label: "Only No Answer",
          count: leakNoAnswer.NO_ANSWER,
          colorKey: "NO_ANSWER",
          crmFilter: "NO_ANSWER",
        },
        {
          key: "vm",
          label: "Only Voicemail",
          count: leakNoAnswer.CALL_COMPLETED,
          colorKey: "CALL_COMPLETED",
          crmFilter: "VOICEMAIL",
        },
        {
          key: "wn",
          label: "Wrong Number",
          count: leakNoAnswer.WRONG_NUMBER,
          colorKey: "WRONG_NUMBER",
          crmFilter: "WRONG_NUMBER",
        },
        {
          key: "other",
          label: "Dialed, outcome not logged",
          count: leakNoAnswer.other,
          colorKey: "NO_ANSWER",
          crmFilter: "ALL",
        },
      ]
    ),
    stage(
      "OWNER",
      "Spoke with the owner",
      "Real conversation with the decision maker.",
      ownerLeads,
      answeredLeads,
      CALL_STATUS_DEFS.CONNECTED.hex,
      [
        {
          key: "gk",
          label: "Stopped at gatekeeper",
          count: gatekeeperOnly,
          colorKey: "GATEKEEPER_BLOCKED",
          crmFilter: "GATEKEEPER",
        },
      ]
    ),
    stage(
      "MEETING",
      "Meeting booked",
      "Owner agreed to a demo or meeting.",
      meetingLeads,
      ownerLeads,
      CALL_STATUS_DEFS.MEETING_BOOKED.hex,
      [
        {
          key: "ni",
          label: "Not interested",
          count: ownerDeclined,
          colorKey: "NOT_INTERESTED",
          crmFilter: "NOT_INTERESTED",
        },
        {
          key: "open",
          label: "Open, follow-up set",
          count: ownerOpenWithNext,
          colorKey: "CONNECTED",
          crmFilter: "FOLLOW_UP",
        },
        {
          key: "leak",
          label: "Open, NO next step",
          count: ownerOpenNoNext,
          colorKey: "CONNECTED",
          crmFilter: "CONNECTED",
        },
      ]
    ),
  ];

  // ---- dial level ---------------------------------------------------------
  const outcomeCounts = emptyOutcomeCounts();
  for (const e of scopedEvents) outcomeCounts[e.outcome]++;
  const dialsTotal = scopedEvents.length;
  const human =
    outcomeCounts.GATEKEEPER_BLOCKED +
    outcomeCounts.CONNECTED +
    outcomeCounts.NOT_INTERESTED +
    outcomeCounts.MEETING_BOOKED;
  const ownerConv =
    outcomeCounts.CONNECTED + outcomeCounts.NOT_INTERESTED + outcomeCounts.MEETING_BOOKED;
  const meetings = outcomeCounts.MEETING_BOOKED;

  // ---- current status snapshot (same function the CRM uses) ---------------
  const statusCounts = Object.fromEntries(
    (Object.keys(CALL_STATUS_DEFS) as CallStatusKey[]).map((k) => [k, 0])
  ) as Record<CallStatusKey, number>;
  let fuScheduled = 0;
  let fuOverdue = 0;
  let ownerNoNext = 0;
  const zoneMap = new Map<UsTimezoneGroup["id"], ZoneLeadCount>();
  let missingState = 0;
  for (const l of poolLeads) {
    const d = deriveCallStatus(l);
    statusCounts[d.key]++;
    const fu = extractFollowUp(l.notes);
    if (fu && d.key !== "NOT_INTERESTED") {
      fuScheduled++;
      if (isFollowUpOverdue(fu, nowMs)) fuOverdue++;
    }
    if (d.key === "CONNECTED" && !fu) ownerNoNext++;

    const zone = zoneForState(l.state);
    if (!zone) {
      missingState++;
    } else {
      const z = zoneMap.get(zone.groupId) ?? {
        groupId: zone.groupId,
        total: 0,
        untouched: 0,
        retry: 0,
      };
      z.total++;
      if (d.key === "UNTOUCHED") z.untouched++;
      if (d.key === "NO_ANSWER" || d.key === "CALL_COMPLETED" || d.key === "GATEKEEPER_BLOCKED") z.retry++;
      zoneMap.set(zone.groupId, z);
    }
  }

  // ---- attempt ladder -----------------------------------------------------
  const ladder = [1, 2, 3, 4].map((n) => ({
    attempt: n === 4 ? "4th+" : n === 1 ? "1st" : n === 2 ? "2nd" : "3rd",
    dials: 0,
    human: 0,
    owner: 0,
    rate: 0,
  }));
  {
    const seen = new Map<string, number>();
    const allByLead = events
      .filter((e) => poolIds.has(e.companyId))
      .sort((a, b) => a.atMs - b.atMs);
    for (const e of allByLead) {
      const n = (seen.get(e.companyId) ?? 0) + 1;
      seen.set(e.companyId, n);
      if (!inRange(e)) continue;
      const row = ladder[Math.min(n, 4) - 1]!;
      row.dials++;
      const d = CALL_STATUS_DEFS[e.outcome].depth;
      if (d >= 2) row.human++;
      if (d >= 3) row.owner++;
    }
    for (const r of ladder) r.rate = pct(r.human, r.dials);
  }

  // ---- 14 day daily series (PKT days, ignores the timeframe selector) -----
  const dailyMap = new Map<string, DailyPoint>();
  for (let i = 13; i >= 0; i--) {
    const ms = nowMs - i * 86400000;
    const key = zonedDayKey(ms, CALLER_TIMEZONE);
    dailyMap.set(key, {
      dayKey: key,
      dayLabel: zonedDayLabel(ms, CALLER_TIMEZONE),
      dials: 0,
      human: 0,
      owner: 0,
      meetings: 0,
    });
  }
  for (const e of events) {
    if (!poolIds.has(e.companyId)) continue;
    const p = dailyMap.get(zonedDayKey(e.atMs, CALLER_TIMEZONE));
    if (!p) continue;
    const d = CALL_STATUS_DEFS[e.outcome].depth;
    p.dials++;
    if (d >= 2) p.human++;
    if (d >= 3) p.owner++;
    if (d >= 4) p.meetings++;
  }

  // ---- timing (audit events only: exact timestamps) -----------------------
  const blankHours = (): HourStat[] =>
    Array.from({ length: 24 }, (_, hour) => ({
      hour,
      dials: 0,
      human: 0,
      owner: 0,
      meetings: 0,
      rate: 0,
    }));
  const prospectHours = blankHours();
  const callerHours = blankHours();
  let prospectDials = 0;
  let unknownZoneDials = 0;
  let timedHuman = 0;
  for (const e of scopedEvents) {
    if (e.source !== "audit") continue;
    const d = CALL_STATUS_DEFS[e.outcome].depth;
    const ch = callerHours[wallClock(e.atMs, CALLER_TIMEZONE).hour]!;
    ch.dials++;
    if (d >= 2) ch.human++;
    if (d >= 3) ch.owner++;
    if (d >= 4) ch.meetings++;

    const zone = zoneForState(leadById.get(e.companyId)?.state);
    if (!zone) {
      unknownZoneDials++;
      continue;
    }
    prospectDials++;
    if (d >= 2) timedHuman++;
    const ph = prospectHours[wallClock(e.atMs, zone.iana).hour]!;
    ph.dials++;
    if (d >= 2) ph.human++;
    if (d >= 3) ph.owner++;
    if (d >= 4) ph.meetings++;
  }
  for (const h of prospectHours) h.rate = pct(h.human, h.dials);
  for (const h of callerHours) h.rate = pct(h.human, h.dials);
  const overallTimedRate = pct(timedHuman, prospectDials);
  const { best, worst } = windowFromHours(prospectHours, overallTimedRate);
  const confidence: FunnelResult["timing"]["confidence"] =
    prospectDials === 0 ? "NONE" : prospectDials < 40 ? "LOW" : prospectDials < 150 ? "MEDIUM" : "HIGH";

  // ---- caller leaderboard (attribution by who made the call) --------------
  const callerRows = new Map<string, CallerRow>();
  for (const m of members) {
    callerRows.set(m.id, {
      id: m.id,
      name: m.name,
      title: m.title || "Sales Caller",
      assignedLeads: 0,
      untouchedLeft: 0,
      overdueFollowUps: 0,
      dials: 0,
      human: 0,
      owner: 0,
      meetings: 0,
      noAnswer: 0,
      gatekeeper: 0,
      notInterested: 0,
      pickRate: 0,
      ownerRate: 0,
      closeRate: 0,
      lastCallMs: null,
    });
  }
  for (const l of allLeads) {
    if (!l.assignedMemberId) continue;
    const row = callerRows.get(l.assignedMemberId);
    if (!row) continue;
    row.assignedLeads++;
    const d = deriveCallStatus(l);
    if (d.key === "UNTOUCHED") row.untouchedLeft++;
    const fu = extractFollowUp(l.notes);
    if (fu && d.key !== "NOT_INTERESTED" && isFollowUpOverdue(fu, nowMs)) row.overdueFollowUps++;
  }
  for (const e of events) {
    if (!inRange(e)) continue;
    if (!e.memberId) continue;
    const row = callerRows.get(e.memberId);
    if (!row) continue;
    const d = CALL_STATUS_DEFS[e.outcome].depth;
    row.dials++;
    if (d >= 2) row.human++;
    if (d >= 3) row.owner++;
    if (d >= 4) row.meetings++;
    if (e.outcome === "NO_ANSWER") row.noAnswer++;
    if (e.outcome === "GATEKEEPER_BLOCKED") row.gatekeeper++;
    if (e.outcome === "NOT_INTERESTED") row.notInterested++;
    row.lastCallMs = Math.max(row.lastCallMs ?? 0, e.atMs);
  }
  for (const r of callerRows.values()) {
    r.pickRate = pct(r.human, r.dials);
    r.ownerRate = pct(r.owner, r.dials);
    r.closeRate = pct(r.meetings, r.owner);
  }

  // ---- ICP tiers (lead level) --------------------------------------------
  const tiers: TierRow[] = [
    { id: "A", label: "Tier A", range: "ICP 80-100", leads: 0, dialed: 0, answered: 0, owner: 0, meetings: 0, answerRate: 0, meetingRate: 0 },
    { id: "B", label: "Tier B", range: "ICP 50-79", leads: 0, dialed: 0, answered: 0, owner: 0, meetings: 0, answerRate: 0, meetingRate: 0 },
    { id: "C", label: "Tier C", range: "ICP below 50", leads: 0, dialed: 0, answered: 0, owner: 0, meetings: 0, answerRate: 0, meetingRate: 0 },
  ];
  for (const l of poolLeads) {
    const score = l.icpScore ?? 0;
    const t = tiers[score >= 80 ? 0 : score >= 50 ? 1 : 2]!;
    t.leads++;
    const depth = perLead.get(l.id)?.depth ?? 0;
    if (depth >= 1) t.dialed++;
    if (depth >= 2) t.answered++;
    if (depth >= 3) t.owner++;
    if (depth >= 4) t.meetings++;
  }
  for (const t of tiers) {
    t.answerRate = pct(t.answered, t.dialed);
    t.meetingRate = pct(t.meetings, t.dialed);
  }

  const attemptsSum = [...perLead.values()].reduce((s, x) => s + x.attempts, 0);

  return {
    pool,
    stages,
    outcomeCounts,
    statusCounts,
    dial: {
      total: dialsTotal,
      human,
      owner: ownerConv,
      meetings,
      pickRate: pct(human, dialsTotal),
      ownerRate: pct(ownerConv, dialsTotal),
      closeRate: pct(meetings, ownerConv),
      dialsPerOwner: ownerConv > 0 ? Math.round(dialsTotal / ownerConv) : 0,
      dialsPerMeeting: meetings > 0 ? Math.round(dialsTotal / meetings) : 0,
      avgAttempts: dialedLeads > 0 ? Math.round((attemptsSum / dialedLeads) * 10) / 10 : 0,
      dialedLeads,
    },
    followUps: { scheduled: fuScheduled, overdue: fuOverdue, ownerNoNextStep: ownerNoNext },
    attemptLadder: ladder,
    daily: [...dailyMap.values()],
    timing: {
      prospectHours,
      callerHours,
      prospectDials,
      unknownZoneDials,
      golden: best,
      weakest: worst,
      confidence,
      zoneLeads: US_TZ_GROUPS.map(
        (g) => zoneMap.get(g.id) ?? { groupId: g.id, total: 0, untouched: 0, retry: 0 }
      ),
      overallRate: overallTimedRate,
    },
    callers: [...callerRows.values()],
    tiers,
    quality: {
      auditCalls: events.filter((e) => e.source === "audit" && poolIds.has(e.companyId)).length,
      legacyNoteCalls: events.filter((e) => e.source === "note" && poolIds.has(e.companyId)).length,
      leadsMissingState: missingState,
    },
  };
}
