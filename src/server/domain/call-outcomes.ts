/**
 * Single source of truth for "what happened on a call".
 *
 * The CRM (call status column, filters, log-call picker) and the Sales Funnel
 * analytics page BOTH import from here, so labels, colors and counting rules can
 * never drift apart. Pure TypeScript: safe for server and client bundles.
 */

import { parseFollowUpMs } from "./call-time";

export type CallOutcomeKey =
  | "NO_ANSWER"
  | "CALL_COMPLETED" // legacy enum name for "Left Voicemail"
  | "WRONG_NUMBER"
  | "GATEKEEPER_BLOCKED"
  | "CONNECTED"
  | "NOT_INTERESTED"
  | "MEETING_BOOKED";

export type CallStatusKey = CallOutcomeKey | "UNTOUCHED";

/** How far a lead got: 0 never dialed, 1 dialed, 2 human answered, 3 owner conversation, 4 meeting booked. */
export type FunnelDepth = 0 | 1 | 2 | 3 | 4;

export type OutcomeGroup = "NO_CONTACT" | "REACHED" | "WIN";

export interface CallStatusDef {
  key: CallStatusKey;
  /** Label shown in the UI. */
  label: string;
  /** Exact label written into the notes log: [Oct 28, 3:05 PM • Name (noteLabel)]: text */
  noteLabel: string;
  group: OutcomeGroup | "NONE";
  depth: FunnelDepth;
  /** Hex used by charts (SVG / inline styles). */
  hex: string;
  /** Tailwind classes (written out in full so Tailwind can see them). */
  badge: string;
  dot: string;
  selected: string;
  /** One line: what this status means. */
  meaning: string;
  /** One line: when the caller should pick it. */
  whenToUse: string;
}

export const CALL_STATUS_DEFS: Record<CallStatusKey, CallStatusDef> = {
  UNTOUCHED: {
    key: "UNTOUCHED",
    label: "Not Called Yet",
    noteLabel: "",
    group: "NONE",
    depth: 0,
    hex: "#71717a",
    badge: "bg-zinc-800/60 text-zinc-300 border-zinc-600/60 border-dashed",
    dot: "bg-zinc-500",
    selected: "border-zinc-400 bg-zinc-700/40 ring-1 ring-zinc-400/60",
    meaning: "No call has been logged for this lead.",
    whenToUse: "Automatic. Every new lead starts here.",
  },
  NO_ANSWER: {
    key: "NO_ANSWER",
    label: "No Answer",
    noteLabel: "No Answer",
    group: "NO_CONTACT",
    depth: 1,
    hex: "#94a3b8",
    badge: "bg-slate-500/15 text-slate-200 border-slate-400/40",
    dot: "bg-slate-400",
    selected: "border-slate-300 bg-slate-500/20 ring-1 ring-slate-300/60",
    meaning: "Phone rang out or was busy. Nobody picked up.",
    whenToUse: "4-5 rings with no pickup, busy tone, or call dropped.",
  },
  CALL_COMPLETED: {
    key: "CALL_COMPLETED",
    label: "Left Voicemail",
    noteLabel: "Left Voicemail",
    group: "NO_CONTACT",
    depth: 1,
    hex: "#a78bfa",
    badge: "bg-violet-500/15 text-violet-200 border-violet-400/40",
    dot: "bg-violet-400",
    selected: "border-violet-300 bg-violet-500/20 ring-1 ring-violet-300/60",
    meaning: "A machine answered and a message was left.",
    whenToUse: "You reached voicemail and left a message.",
  },
  WRONG_NUMBER: {
    key: "WRONG_NUMBER",
    label: "Wrong Number",
    noteLabel: "Wrong Number",
    group: "NO_CONTACT",
    depth: 1,
    hex: "#f472b6",
    badge: "bg-pink-500/15 text-pink-200 border-pink-400/40",
    dot: "bg-pink-400",
    selected: "border-pink-300 bg-pink-500/20 ring-1 ring-pink-300/60",
    meaning: "Number is disconnected or belongs to someone else.",
    whenToUse: "Disconnected line, fax tone, or a different business.",
  },
  GATEKEEPER_BLOCKED: {
    key: "GATEKEEPER_BLOCKED",
    label: "Gatekeeper",
    noteLabel: "Gatekeeper",
    group: "REACHED",
    depth: 2,
    hex: "#fbbf24",
    badge: "bg-amber-500/15 text-amber-200 border-amber-400/40",
    dot: "bg-amber-400",
    selected: "border-amber-300 bg-amber-500/20 ring-1 ring-amber-300/60",
    meaning: "A human answered but did not connect you to the owner.",
    whenToUse: "Receptionist or assistant refused the transfer.",
  },
  CONNECTED: {
    key: "CONNECTED",
    label: "Connected / Spoke",
    noteLabel: "Connected / Spoke",
    group: "REACHED",
    depth: 3,
    hex: "#38bdf8",
    badge: "bg-sky-500/15 text-sky-200 border-sky-400/40",
    dot: "bg-sky-400",
    selected: "border-sky-300 bg-sky-500/20 ring-1 ring-sky-300/60",
    meaning: "You had a real conversation with the owner / decision maker.",
    whenToUse: "You spoke with the owner and the conversation is still open.",
  },
  NOT_INTERESTED: {
    key: "NOT_INTERESTED",
    label: "Not Interested",
    noteLabel: "Not Interested",
    group: "REACHED",
    depth: 3,
    hex: "#f87171",
    badge: "bg-red-500/15 text-red-200 border-red-400/40",
    dot: "bg-red-400",
    selected: "border-red-300 bg-red-500/20 ring-1 ring-red-300/60",
    meaning: "You spoke with the owner and they clearly declined.",
    whenToUse: "Owner said no / not now / already has a solution.",
  },
  MEETING_BOOKED: {
    key: "MEETING_BOOKED",
    label: "Meeting Booked",
    noteLabel: "Meeting Booked",
    group: "WIN",
    depth: 4,
    hex: "#34d399",
    badge: "bg-emerald-500/20 text-emerald-200 border-emerald-400/50",
    dot: "bg-emerald-400",
    selected: "border-emerald-300 bg-emerald-500/20 ring-1 ring-emerald-300/60",
    meaning: "Owner agreed to a demo or meeting.",
    whenToUse: "A date and time is agreed. Also set the follow-up date.",
  },
};

/** Order and grouping used by the Log Call picker and the legend. */
export const OUTCOME_GROUPS: Array<{
  id: OutcomeGroup;
  title: string;
  hint: string;
  keys: CallOutcomeKey[];
}> = [
  {
    id: "NO_CONTACT",
    title: "Did not reach anyone",
    hint: "Machine, ring-out or dead number",
    keys: ["NO_ANSWER", "CALL_COMPLETED", "WRONG_NUMBER"],
  },
  {
    id: "REACHED",
    title: "A human picked up",
    hint: "Front desk or the owner",
    keys: ["GATEKEEPER_BLOCKED", "CONNECTED", "NOT_INTERESTED"],
  },
  {
    id: "WIN",
    title: "Success",
    hint: "Deal moved forward",
    keys: ["MEETING_BOOKED"],
  },
];

export const ALL_OUTCOME_KEYS: CallOutcomeKey[] = OUTCOME_GROUPS.flatMap((g) => g.keys);

export function getStatusDef(key: CallStatusKey): CallStatusDef {
  return CALL_STATUS_DEFS[key];
}

/** Outcomes where a real person answered the phone. */
export function isHumanAnswer(key: CallOutcomeKey): boolean {
  return CALL_STATUS_DEFS[key].depth >= 2;
}

/** Outcomes where the owner / decision maker was actually spoken to. */
export function isOwnerConversation(key: CallOutcomeKey): boolean {
  return CALL_STATUS_DEFS[key].depth >= 3;
}

/** Maps the text written in the notes log (or typed by hand) to an outcome. */
export function outcomeKeyFromLabel(label: string | null | undefined): CallOutcomeKey | null {
  const t = (label || "").trim().toLowerCase();
  if (!t) return null;
  // A bare "meeting" must NOT count as booked ("owner is in a meeting" is a gatekeeper block).
  if (/\b(meeting|demo|appointment)\s*(booked|scheduled|set|confirmed)\b|\bbooked\b/.test(t)) {
    return "MEETING_BOOKED";
  }
  if (t.includes("not interested") || t.includes("declined")) return "NOT_INTERESTED";
  if (t.includes("connected") || t.includes("spoke")) return "CONNECTED";
  if (t.includes("gatekeeper")) return "GATEKEEPER_BLOCKED";
  if (t.includes("no answer") || t.includes("rang out")) return "NO_ANSWER";
  if (t.includes("voicemail") || t.includes("voice mail")) return "CALL_COMPLETED";
  // "wrong extension / wrong time" is not a dead number.
  if (/wrong\s*(number|person|company)/.test(t)) return "WRONG_NUMBER";
  return null;
}

// ---------------------------------------------------------------------------
// Conservative refinement of a generic "Connected / Spoke" selection
// ---------------------------------------------------------------------------

const REFINE_MEETING =
  /\b((meeting|demo|appointment|zoom)\s*(booked|scheduled|set|confirmed|fixed)|booked\s*(a\s*)?(meeting|demo|appointment|zoom)|calendar\s*invite|agreed\s*to\s*(meet|demo)|pitch\s*meeting|(intro|discovery)\s*call\s*(booked|scheduled|confirmed))\b/i;
const REFINE_STRONG_REFUSAL =
  /\b(not\s*interested|do\s*not\s*call|dnc|remove\s*(me|my\s*number|their\s*number|from\s*(the\s*)?list)|stop\s*calling|declined|said\s*no)\b/i;
/** A refusal that also names a later date is a deferral, not a loss. */
const REFINE_DEFERRAL =
  /\b(call\s*-?back|follow\s*-?up|try\s*(again|later)|later|next\s*(week|month|quarter|year)|in\s*(a\s*)?(few|\d+)\s*(days?|weeks?|months?)|tomorrow)\b/i;
const REFINE_DEAD_NUMBER =
  /\b(wrong\s*number|invalid\s*number|disconnected|not\s*in\s*service|out\s*of\s*service|fax\s*line|bad\s*number)\b/i;
const REFINE_VOICEMAIL =
  /\b(left\s*(a\s*)?(voice\s*mail|vm|message)|went\s*to\s*voice\s*mail|sent\s*to\s*voice\s*mail|voice\s*mail|answering\s*machine|mailbox\s*full)\b/i;
const REFINE_GATEKEEPER =
  /\b(gatekeeper|refused\s*(to\s*)?(transfer|put\s*(me\s*)?through)|wouldn'?t\s*(transfer|put\s*(me\s*)?through)|not\s*putting\s*(me\s*)?through|took\s*a\s*message|receptionist\s*(said|picked|answered|took|refused)|front\s*desk\s*(said|answered|picked|refused))\b/i;
const REFINE_NO_ANSWER =
  /\b(no\s*one\s*picked\s*up|nobody\s*picked\s*up|no\s*one\s*answered|nobody\s*answered|no\s*answer|didn'?t\s*pick\s*up|didn'?t\s*answer|rang\s*out)\b/i;

/**
 * The caller picked the generic "Connected / Spoke" but the note clearly says something more
 * specific. Used by BOTH the server (when logging) and parseCallLog (when reading), so the
 * stored label and the derived status can never disagree. Explicit non-generic selections are
 * never overridden, and a refusal that names a later date stays alive as a follow-up.
 */
export function refineConnectedOutcome(text: string | null | undefined): CallOutcomeKey | null {
  const t = (text || "").trim();
  if (!t) return null;
  if (REFINE_MEETING.test(t)) return "MEETING_BOOKED";
  if (REFINE_STRONG_REFUSAL.test(t) && !REFINE_DEFERRAL.test(t)) return "NOT_INTERESTED";
  if (REFINE_DEAD_NUMBER.test(t)) return "WRONG_NUMBER";
  if (REFINE_VOICEMAIL.test(t)) return "CALL_COMPLETED";
  if (REFINE_GATEKEEPER.test(t)) return "GATEKEEPER_BLOCKED";
  if (REFINE_NO_ANSWER.test(t)) return "NO_ANSWER";
  return null;
}

/** Lifecycle status a call outcome moves a lead to (shared by server and optimistic UI). */
export function lifecycleStatusForOutcome(
  outcome: CallOutcomeKey
): "MEETING_BOOKED" | "LOST" | "CONNECTED" | "NURTURE" | "CALLING" {
  switch (outcome) {
    case "MEETING_BOOKED":
      return "MEETING_BOOKED";
    case "NOT_INTERESTED":
      return "LOST";
    case "CONNECTED":
      return "CONNECTED";
    case "WRONG_NUMBER":
      return "NURTURE";
    default:
      return "CALLING";
  }
}

/**
 * Infers a CallOutcomeKey from freeform caller notes, inline table notes,
 * follow-up reminders, or custom column dropdown values.
 */
export function inferOutcomeFromText(text: string | null | undefined): CallOutcomeKey | null {
  const t = (text || "").trim().toLowerCase();
  if (!t) return null;
  const direct = outcomeKeyFromLabel(t);
  if (direct) return direct;

  // 1. Meeting Booked (Highest intent milestone)
  // NOTE: "schedule(d) a call back" / "call back tomorrow" is a callback, NOT a booked meeting.
  if (
    /\b((meeting|demo|appointment|zoom)\s*(booked|scheduled|set|confirmed|fixed)|booked\s*(a\s*)?(meeting|demo|appointment|zoom|call(?!\s*-?back))|scheduled\s*(a\s*)?(meeting|demo|appointment|zoom|call(?!\s*-?back))|calendar\s*invite|agreed\s*to\s*(meet|demo|chat)|closed\s*deal|pitch\s*meeting|intro\s*call\s*booked|discovery\s*call\s*booked|booked\s*for\s*(mon|tue|wed|thu|fri|sat|sun|today|tomorrow|next\s*week|\d{1,2}))\b/i.test(
      t
    )
  ) {
    return "MEETING_BOOKED";
  }

  // 2. Not Interested / DNC (Explicit refusal)
  if (
    /\b(not\s*interested|no\s*interest|declined|hung\s*up|hanged\s*up|do\s*not\s*call|dnc|remove\s*(me|from\s*list|number)|stop\s*calling|don't\s*need|no\s*need|already\s*(have|satisfied|got|using|integrated)|happy\s*with\s*(whatever|what)\s*they\s*have|handle\s*(the\s*)?calls\s*themsel(f|ves)|said\s*no|mana\s*kar\s*diya|not\s*looking|rejected|spam|uninterested)\b/i.test(
      t
    )
  ) {
    return "NOT_INTERESTED";
  }

  // 3. Wrong / Dead / Disconnected Number
  if (
    /\b(wrong\s*number|wrong\s*lead|invalid\s*number|disconnected|not\s*in\s*service|bad\s*number|out\s*of\s*service|fax\s*line|dead\s*line|changed\s*number|wrong\s*person|wrong\s*company|galat\s*number|number\s*band|no\s*longer\s*(works|in\s*business|there))\b/i.test(
      t
    )
  ) {
    return "WRONG_NUMBER";
  }

  // 4. Voicemail / Answering Machine
  if (
    /\b(left\s*(a\s*)?voicemail|left\s*(a\s*)?vm|voicemail|voice\s*mail|left\s*(a\s*)?message|vm\s*left|sent\s*to\s*voicemail|mailbox\s*full|answering\s*machine|automated\s*(message|greeting)|recorded\s*greeting|vm\s*dropped|audio\s*mail)\b/i.test(
      t
    )
  ) {
    return "CALL_COMPLETED";
  }

  // 5. No Answer / Rang Out / Busy Signal
  if (
    /\b(no\s*answer|didn't\s*answer|did\s*not\s*answer|no\s*one\s*(picked\s*up|answered|is\s*available|was\s*available)|nobody\s*(picked\s*up|answered)|rang\s*out|no\s*pick\s*up|didn't\s*pick\s*up|did\s*not\s*pick\s*up|not\s*picking|busy\s*signal|line\s*busy|busy\s*tone|unanswered|no\s*response|call\s*(dropped|disconnect|ended)|cut\s*the\s*call|office\s*(is\s*)?closed|unavailable\s*to\s*take|^\s*unavailable\s*$)\b/i.test(
      t
    ) ||
    t === "na" ||
    t === "n/a" ||
    t === "rnr" ||
    t === "ringing" ||
    t === "unavailable"
  ) {
    return "NO_ANSWER";
  }

  // 6. Gatekeeper / Receptionist Blocked
  if (
    /\b(gatekeeper|receptionist|front\s*desk|secretary|assistant|office\s*manager|wouldn't\s*transfer|refused\s*(to\s*)?(transfer|put\s*through)|not\s*putting\s*through|in\s*a\s*meeting|not\s*available|isn't\s*available|wasn't\s*available|busy\s*(right\s*now|with\s*other)|out\s*of\s*office|took\s*a\s*message|send\s*email\s*to\s*(info|office)|contact\s*them\s*on\s*email|gave\s*me\s*the\s*email|boss\s*(is\s*)?busy|owner\s*(is\s*|was\s*|isn't\s*|wasn't\s*)?(unavailable|not\s*available|available|not\s*in|away|out)|manager\s*not\s*in)\b/i.test(
      t
    )
  ) {
    return "GATEKEEPER_BLOCKED";
  }

  // 7. Spoke / Connected / Conversation
  if (
    /\b(connected|spoke\s*(with|to)?|talked\s*(with|to)?|answered|picked\s*up|owner\s*(said|answered)|decision\s*maker\s*(answered|spoke)|discussed|interested|call\s*back|callback|follow\s*up|send\s*(info|details|proposal|pricing)|confirmed|qualified|pitch\s*delivered)\b/i.test(
      t
    )
  ) {
    return "CONNECTED";
  }
  return null;
}

/** Maps the raw enum stored in audit logs to an outcome. */
export function outcomeKeyFromEnum(raw: string | null | undefined): CallOutcomeKey | null {
  const v = (raw || "").trim().toUpperCase();
  if ((ALL_OUTCOME_KEYS as string[]).includes(v)) return v as CallOutcomeKey;
  return outcomeKeyFromLabel(raw) || inferOutcomeFromText(raw);
}

// ---------------------------------------------------------------------------
// Notes log parsing
// ---------------------------------------------------------------------------

export interface ParsedCallLogEntry {
  /** Raw timestamp text exactly as written, e.g. "Oct 28, 3:05 PM". */
  timestampRaw: string;
  author: string;
  outcome: CallOutcomeKey;
  text: string;
}

const CALL_LOG_LINE = /^\[([^•\u2022\]]+)(?:[•\u2022]\s*([^(]+))?(?:\(([^)]+)\))?\]?:?\s*(.*)$/;
const LEGACY_CALL_DATE_LINE = /^\[Call\s+([^\]]+)\]:?\s*(.*)$/i;
const FOLLOW_UP_NOTE_LINE = /^\[Follow-Up Note\s+([^\]]+)\]\s*(.*)$/i;

export function isSystemBattlecardOrTagLine(line: string): boolean {
  if (!line) return true;
  const clean = line.replace(/^[🎯📍🔥📞💡⚡]+\s*/u, "").trim();
  if (/^\[(?:Next )?Follow-?up Scheduled:\s*[^\]]+\]$/i.test(clean)) return true;
  if (/\((?:Ready to Call|Number Corrected|Outcome Reset)\)\]/i.test(clean)) return true;
  if (clean.startsWith("--- COLD CALLER") || clean.startsWith("--- BATTLECARD")) return true;
  if (
    (clean.startsWith('"Hey ') || clean.startsWith('"Hi ')) &&
    (clean.includes("The reason for my call:") ||
      clean.includes("We deploy custom") ||
      clean.includes("automated instant response system"))
  ) {
    return true;
  }
  return (
    clean.startsWith("BATTLECARD:") ||
    clean.startsWith("15-SECOND OPENING SCRIPT:") ||
    clean.startsWith("Decision Maker:") ||
    clean.startsWith("Growth Signal:") ||
    clean.startsWith("Focus:") ||
    clean.startsWith("Local Market:") ||
    clean.startsWith("Gatekeeper Strategy:") ||
    clean.startsWith("Reputation:") ||
    clean.startsWith("Authority:") ||
    clean.startsWith("PITCH ANGLE:") ||
    clean.startsWith("Verified Direct") ||
    clean.startsWith("Added directly to Leads CRM")
  );
}

/** Returns every logged call in the notes, newest first (new calls are prepended). */
export function parseCallLog(notes: string | null | undefined): ParsedCallLogEntry[] {
  if (!notes) return [];
  const cleanedNotes = notes.replace(/\[(?:Next )?Follow-?up Scheduled:\s*[^\]]+\]\s*/gi, "");
  const out: ParsedCallLogEntry[] = [];
  const freeformLines: string[] = [];

  for (const rawLine of cleanedNotes.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // If a lead was explicitly reset to "(Ready to Call)", stop parsing older pre-reset call history below it
    if (/\(Ready to Call\)\]/i.test(line)) {
      break;
    }

    if (isSystemBattlecardOrTagLine(line)) continue;

    if (line.startsWith("[")) {
      const legacyCall = line.match(LEGACY_CALL_DATE_LINE);
      if (legacyCall) {
        const noteText = (legacyCall[2] || "").trim();
        const outcome = inferOutcomeFromText(noteText) ?? "CONNECTED";
        out.push({
          timestampRaw: (legacyCall[1] || "").trim(),
          author: "",
          outcome,
          text: noteText,
        });
        continue;
      }

      const fm = line.match(FOLLOW_UP_NOTE_LINE);
      if (fm) {
        const noteText = (fm[2] || "").trim();
        const outcome = inferOutcomeFromText(noteText) ?? "CONNECTED";
        out.push({
          timestampRaw: (fm[1] || "").trim(),
          author: "",
          outcome,
          text: noteText,
        });
        continue;
      }

      const m = line.match(CALL_LOG_LINE);
      if (m) {
        const labelOutcome = outcomeKeyFromLabel(m[3]) || inferOutcomeFromText(m[3]);
        const noteText = (m[4] || "").trim();
        // The label the caller (or server) wrote is authoritative. Only the generic
        // "Connected / Spoke" label may be refined by an unambiguous note
        // (same rule the server applies when it writes the log, see refineConnectedOutcome).
        const outcome =
          labelOutcome === "CONNECTED"
            ? refineConnectedOutcome(noteText) ?? labelOutcome
            : labelOutcome || inferOutcomeFromText(noteText);

        if (outcome) {
          out.push({
            timestampRaw: (m[1] || "").trim(),
            author: (m[2] || "").trim(),
            outcome,
            text: noteText,
          });
          continue;
        }
      }
    }

    freeformLines.push(line);
  }

  // If the caller typed freeform inline notes directly into the CRM without a [timestamp] header,
  // treat those human caller notes as a logged call entry so CRM counters and analytics stay in sync.
  // A plain note typed straight into the CRM only counts as a call when it clearly says what
  // happened ("no answer on cell"). Notes like "check website" are notes, not calls.
  if (out.length === 0 && freeformLines.length > 0) {
    const combinedFreeform = freeformLines.join(" — ");
    const inferred = inferOutcomeFromText(combinedFreeform);
    if (inferred) {
      out.push({
        timestampRaw: "Inline CRM Note",
        author: "",
        outcome: inferred,
        text: combinedFreeform,
      });
    }
  } else if (out.length > 0 && freeformLines.length > 0) {
    for (const fl of freeformLines) {
      const inferred = inferOutcomeFromText(fl);
      if (inferred) {
        out.push({
          timestampRaw: "Inline CRM Note",
          author: "",
          outcome: inferred,
          text: fl,
        });
      }
    }
  }

  return out;
}

export function extractFollowUp(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const matches = [...notes.matchAll(/\[(?:Next )?Follow-?up Scheduled:\s*([^\]]+)\]/gi)];
  if (matches.length === 0) return null;
  // Always pick matches[0] because new follow-up tags are prepended at the top of notes
  return matches[0]?.[1]?.trim() || null;
}

/**
 * The note timestamp has no year ("Oct 28, 3:05 PM"). Pick the year that puts the
 * date closest to `now` without landing in the future.
 */
export function parseNoteTimestamp(raw: string, nowMs: number): number | null {
  const m = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) {
    const direct = Date.parse(raw);
    return Number.isNaN(direct) ? null : direct;
  }
  const monthIdx = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ].indexOf(m[1]!.slice(0, 3).toLowerCase());
  if (monthIdx < 0) return null;
  let hour = Number(m[3]) % 12;
  if (m[5]!.toUpperCase() === "PM") hour += 12;
  const nowYear = new Date(nowMs).getUTCFullYear();
  // Notes are stamped in the caller's clock (PKT, UTC+5), so convert back to UTC.
  const PKT_OFFSET_MS = 5 * 3600 * 1000;
  for (const year of [nowYear, nowYear - 1]) {
    const ms = Date.UTC(year, monthIdx, Number(m[2]), hour, Number(m[4])) - PKT_OFFSET_MS;
    if (ms <= nowMs + 36 * 3600 * 1000) return ms;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Derived call status (what the CRM shows instead of a manual "pipeline stage")
// ---------------------------------------------------------------------------

export interface DerivedCallStatus {
  key: CallStatusKey;
  def: CallStatusDef;
  /** Number of calls logged for this lead. */
  attempts: number;
  lastLog: ParsedCallLogEntry | null;
  /** Number of qualification / custom CRM fields confirmed by a caller on this lead. */
  qualifiedFieldsCount: number;
}

const CALLER_SMART_FIELD_KEYS = new Set([
  "decision_maker_confirmed",
  "current_crm",
  "lead_response_speed",
  "after_hours_answering",
  "str_pms_software",
  "twenty_four_seven_concierge",
  "dispatch_model",
  "commercial_mix",
  "intake_speed",
  "caller_last_outcome",
]);

export function inspectCallerSmartFields(
  facts: Record<string, unknown> | null | undefined
): {
  qualifiedFieldsCount: number;
  inferredOutcome: CallOutcomeKey | null;
} {
  if (!facts || typeof facts !== "object") {
    return { qualifiedFieldsCount: 0, inferredOutcome: null };
  }

  let qualifiedFieldsCount = 0;
  let explicitOutcome: CallOutcomeKey | null = null;

  for (const [k, rawVal] of Object.entries(facts)) {
    const isCustomOrSmartKey =
      k.startsWith("custom_") || CALLER_SMART_FIELD_KEYS.has(k);

    let strVal = "";
    let isHumanConfirmed = false;

    if (rawVal && typeof rawVal === "object" && "value" in rawVal) {
      const vObj = rawVal as {
        value?: unknown;
        provenance?: string;
        sourceType?: string;
      };
      strVal = String(vObj.value ?? "").trim();
      isHumanConfirmed =
        vObj.provenance === "HUMAN_CONFIRMED" || vObj.sourceType === "manual_entry";
      if ((vObj.provenance || vObj.sourceType) && !isHumanConfirmed) {
        continue;
      }
    } else if (typeof rawVal === "string" || typeof rawVal === "number") {
      strVal = String(rawVal).trim();
    }

    if (!strVal) continue;
    const lower = strVal.toLowerCase();
    if (
      lower === "ask on call" ||
      lower === "verify on call" ||
      lower === "unknown" ||
      lower === "n/a" ||
      lower === "none"
    ) {
      continue;
    }

    // Only count fields that belong to caller qualification columns or were human-confirmed
    if (!isCustomOrSmartKey && !isHumanConfirmed) continue;
    if (k === "linkedin" || k === "linkedin_url") continue;

    qualifiedFieldsCount++;

    const out = outcomeKeyFromEnum(strVal) || inferOutcomeFromText(strVal);
    if (out) {
      if (
        !explicitOutcome ||
        CALL_STATUS_DEFS[out].depth > CALL_STATUS_DEFS[explicitOutcome].depth
      ) {
        explicitOutcome = out;
      }
    }
  }

  const inferredOutcome: CallOutcomeKey | null =
    explicitOutcome ?? (qualifiedFieldsCount > 0 ? "CONNECTED" : null);

  return { qualifiedFieldsCount, inferredOutcome };
}

/** Minimum depth a lifecycle status implies even when no call log exists (legacy data). */
export function lifecycleDepthFloor(status: string | null | undefined): FunnelDepth {
  switch (status) {
    case "MEETING_BOOKED":
    case "QUALIFIED":
    case "DISCOVERY":
    case "PROPOSAL":
    case "PILOT":
    case "CLOSED":
      return 4;
    case "CONNECTED":
    case "PAIN_FOUND":
      return 3;
    case "CALLING":
    case "NURTURE":
      return 1;
    default:
      return 0;
  }
}

export function deriveCallStatus(lead: {
  status?: string | null;
  notes?: string | null;
  facts?: Record<string, unknown> | null;
  nextFollowUp?: string | null;
}): DerivedCallStatus {
  const log = parseCallLog(lead.notes);
  const lastLog = log[0] ?? null;
  const status = lead.status || "";
  const { qualifiedFieldsCount, inferredOutcome } = inspectCallerSmartFields(lead.facts);
  const hasFollowUp = Boolean(lead.nextFollowUp || extractFollowUp(lead.notes));

  let key: CallStatusKey;
  if (status === "MEETING_BOOKED" || status === "QUALIFIED" || status === "CLOSED") {
    key = "MEETING_BOOKED";
  } else if (lastLog) {
    if (
      status === "PAIN_FOUND" &&
      CALL_STATUS_DEFS[lastLog.outcome].depth < 3
    ) {
      key = "CONNECTED";
    } else if (status === "LOST" && lastLog.outcome !== "NOT_INTERESTED") {
      key = "NOT_INTERESTED";
    } else if (
      status === "APPROVED" &&
      (lastLog.outcome === "WRONG_NUMBER" || lastLog.outcome === "NOT_INTERESTED")
    ) {
      key = "UNTOUCHED";
    } else {
      key = lastLog.outcome;
    }
  } else if (status === "CONNECTED" || status === "PAIN_FOUND") {
    key = "CONNECTED";
  } else if (status === "LOST") {
    key = "NOT_INTERESTED";
  } else if (inferredOutcome) {
    key = inferredOutcome;
  } else if (status === "CALLING" || status === "NURTURE" || hasFollowUp) {
    key = "NO_ANSWER";
  } else {
    key = "UNTOUCHED";
  }

  const attempts = key === "UNTOUCHED" ? 0 : Math.max(log.length, 1);

  return {
    key,
    def: CALL_STATUS_DEFS[key],
    attempts,
    lastLog,
    qualifiedFieldsCount,
  };
}

export interface CallerTelemetrySummary {
  total: number;
  assigned: number;
  untouched: number;
  toCall: number;
  dialedLeads: number;
  callsLogged: number;
  answered: number;
  connected: number;
  meetings: number;
  followUps: number;
  overdueFollowUps: number;
  noAnswer: number;
  gatekeeper: number;
  voicemail: number;
  wrongNumber: number;
  notInterested: number;
  qualifiedLeads: number;
}

export interface LiveCrmTelemetry {
  totalLeads: number;
  untouchedLeads: number;
  dialedLeads: number;
  totalCallsDialed: number;
  answeredLeads: number;
  answeredCalls: number;
  answerRatePct: number;
  connectedLeads: number;
  connectRatePct: number;
  meetingsBooked: number;
  noAnswerLeads: number;
  voicemailLeads: number;
  gatekeeperLeads: number;
  wrongNumberLeads: number;
  notInterestedLeads: number;
  followUpsScheduled: number;
  followUpsOverdue: number;
  qualifiedLeadsCount: number;
  unassignedCount: number;
  statusCounts: Record<CallStatusKey, number>;
  callerMap: Record<string, CallerTelemetrySummary>;
  teamTotals: CallerTelemetrySummary;
}

export function computeLiveCrmTelemetry(
  leads: Array<{
    id?: string;
    companyId?: string;
    status?: string | null;
    notes?: string | null;
    facts?: Record<string, unknown> | null;
    nextFollowUp?: string | null;
    assignedMemberId?: string | null;
  }>,
  teamCallers: Array<{ id: string; name: string; email?: string }> = [],
  nowMs: number = Date.now()
): LiveCrmTelemetry {
  const emptyCallerSummary = (): CallerTelemetrySummary => ({
    total: 0,
    assigned: 0,
    untouched: 0,
    toCall: 0,
    dialedLeads: 0,
    callsLogged: 0,
    answered: 0,
    connected: 0,
    meetings: 0,
    followUps: 0,
    overdueFollowUps: 0,
    noAnswer: 0,
    gatekeeper: 0,
    voicemail: 0,
    wrongNumber: 0,
    notInterested: 0,
    qualifiedLeads: 0,
  });

  const callerMap: Record<string, CallerTelemetrySummary> = {};
  for (const c of teamCallers) {
    callerMap[c.id] = emptyCallerSummary();
  }
  const teamTotals = emptyCallerSummary();

  const statusCounts: Record<CallStatusKey, number> = {
    UNTOUCHED: 0,
    NO_ANSWER: 0,
    CALL_COMPLETED: 0,
    WRONG_NUMBER: 0,
    GATEKEEPER_BLOCKED: 0,
    CONNECTED: 0,
    NOT_INTERESTED: 0,
    MEETING_BOOKED: 0,
  };

  let totalLeads = 0;
  let untouchedLeads = 0;
  let dialedLeads = 0;
  let totalCallsDialed = 0;
  let answeredLeads = 0;
  let answeredCalls = 0;
  let connectedLeads = 0;
  let meetingsBooked = 0;
  let noAnswerLeads = 0;
  let voicemailLeads = 0;
  let gatekeeperLeads = 0;
  let wrongNumberLeads = 0;
  let notInterestedLeads = 0;
  let followUpsScheduled = 0;
  let followUpsOverdue = 0;
  let qualifiedLeadsCount = 0;
  let unassignedCount = 0;

  for (const lead of leads) {
    if ( lead.status === "REJECTED") continue;
    totalLeads++;
    teamTotals.total++;
    teamTotals.assigned++;

    if (!lead.assignedMemberId) {
      unassignedCount++;
    }

    const assignedSummary = lead.assignedMemberId ? callerMap[lead.assignedMemberId] : undefined;
    if (assignedSummary) {
      assignedSummary.total++;
      assignedSummary.assigned++;
    }

    const derived = deriveCallStatus(lead);
    const logs = parseCallLog(lead.notes);
    statusCounts[derived.key]++;

    const fu = lead.nextFollowUp || extractFollowUp(lead.notes);
    const isOverdue = fu ? isFollowUpOverdue(fu, nowMs) : false;

    if (fu && derived.key !== "NOT_INTERESTED") {
      followUpsScheduled++;
      teamTotals.followUps++;
      if (assignedSummary) assignedSummary.followUps++;
      if (isOverdue) {
        followUpsOverdue++;
        teamTotals.overdueFollowUps++;
        if (assignedSummary) assignedSummary.overdueFollowUps++;
      }
    }

    const isQualified =
      derived.qualifiedFieldsCount > 0 || lead.status === "QUALIFIED";

    if (isQualified) {
      qualifiedLeadsCount++;
      teamTotals.qualifiedLeads++;
      if (assignedSummary) assignedSummary.qualifiedLeads++;
    }

    if (derived.key === "UNTOUCHED") {
      untouchedLeads++;
      teamTotals.untouched++;
      teamTotals.toCall++;
      if (assignedSummary) {
        assignedSummary.untouched++;
        assignedSummary.toCall++;
      }
      continue;
    }

    // Lead has been dialed / touched at least once
    dialedLeads++;
    teamTotals.dialedLeads++;
    if (assignedSummary) assignedSummary.dialedLeads++;

    const leadAttempts = Math.max(1, derived.attempts);
    totalCallsDialed += leadAttempts;

    // Lead-level outcome classification
    const depth = derived.def.depth;
    const everHumanInLogs = logs.some((l) => CALL_STATUS_DEFS[l.outcome].depth >= 2);
    const everOwnerInLogs = logs.some((l) => CALL_STATUS_DEFS[l.outcome].depth >= 3);

    if (depth >= 2 || everHumanInLogs) {
      answeredLeads++;
      teamTotals.answered++;
      if (assignedSummary) assignedSummary.answered++;
    }
    if (depth >= 3 || everOwnerInLogs) {
      connectedLeads++;
      teamTotals.connected++;
      if (assignedSummary) assignedSummary.connected++;
    }

    if (derived.key === "MEETING_BOOKED") {
      meetingsBooked++;
      teamTotals.meetings++;
      if (assignedSummary) assignedSummary.meetings++;
    } else if (derived.key === "GATEKEEPER_BLOCKED") {
      gatekeeperLeads++;
      teamTotals.gatekeeper++;
      if (assignedSummary) assignedSummary.gatekeeper++;
    } else if (derived.key === "NO_ANSWER") {
      noAnswerLeads++;
      teamTotals.noAnswer++;
      if (assignedSummary) assignedSummary.noAnswer++;
    } else if (derived.key === "CALL_COMPLETED") {
      voicemailLeads++;
      teamTotals.voicemail++;
      if (assignedSummary) assignedSummary.voicemail++;
    } else if (derived.key === "WRONG_NUMBER") {
      wrongNumberLeads++;
      teamTotals.wrongNumber++;
      if (assignedSummary) assignedSummary.wrongNumber++;
    } else if (derived.key === "NOT_INTERESTED") {
      notInterestedLeads++;
      teamTotals.notInterested++;
      if (assignedSummary) assignedSummary.notInterested++;
    }

    // Attribute individual call attempts to the caller who logged them (or assigned caller)
    if (logs.length > 0) {
      for (const entry of logs) {
        const authorLower = (entry.author || "").trim().toLowerCase();
        const matchedCaller = authorLower
          ? teamCallers.find(
              (c) =>
                c.name.toLowerCase() === authorLower ||
                (c.email && c.email.toLowerCase() === authorLower)
            )
          : undefined;
        const targetCallerSummary =
          assignedSummary ?? (matchedCaller ? callerMap[matchedCaller.id] : undefined);

        teamTotals.callsLogged++;
        if (targetCallerSummary) targetCallerSummary.callsLogged++;

        if (CALL_STATUS_DEFS[entry.outcome].depth >= 2) {
          answeredCalls++;
        }
      }
    } else {
      // Synthesized call from status or smart field update
      teamTotals.callsLogged += leadAttempts;
      if (assignedSummary) assignedSummary.callsLogged += leadAttempts;
      if (depth >= 2) answeredCalls++;
    }
  }

  const answerRatePct = dialedLeads > 0 ? Math.round((answeredLeads / dialedLeads) * 100) : 0;
  const connectRatePct = dialedLeads > 0 ? Math.round((connectedLeads / dialedLeads) * 100) : 0;

  return {
    totalLeads,
    untouchedLeads,
    dialedLeads,
    totalCallsDialed,
    answeredLeads,
    answeredCalls: Math.max(answeredCalls, answeredLeads),
    answerRatePct,
    connectedLeads,
    connectRatePct,
    meetingsBooked,
    noAnswerLeads,
    voicemailLeads,
    gatekeeperLeads,
    wrongNumberLeads,
    notInterestedLeads,
    followUpsScheduled,
    followUpsOverdue,
    qualifiedLeadsCount,
    unassignedCount,
    statusCounts,
    callerMap,
    teamTotals,
  };
}

export function isFollowUpOverdue(
  iso: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  const t = parseFollowUpMs(iso);
  return t !== null && t < nowMs;
}

/**
 * CRM filter keys (also used in deep links such as /caller?status=NO_ANSWER) mapped to the
 * call status they select. FOLLOW_UP and OVERDUE are not statuses, they are date based.
 */
export const STATUS_FILTER_TO_KEY: Record<string, CallStatusKey> = {
  UNTOUCHED: "UNTOUCHED",
  TO_CALL: "UNTOUCHED",
  NO_ANSWER: "NO_ANSWER",
  VOICEMAIL: "CALL_COMPLETED",
  WRONG_NUMBER: "WRONG_NUMBER",
  GATEKEEPER: "GATEKEEPER_BLOCKED",
  CONNECTED: "CONNECTED",
  NOT_INTERESTED: "NOT_INTERESTED",
  MEETINGS: "MEETING_BOOKED",
};

/** Filter chips shown above the CRM table, in funnel order. */
export const CRM_FILTER_CHIPS: Array<{ filter: string; statusKey: CallStatusKey; label: string }> = [
  { filter: "UNTOUCHED", statusKey: "UNTOUCHED", label: "Not Called Yet" },
  { filter: "NO_ANSWER", statusKey: "NO_ANSWER", label: "No Answer" },
  { filter: "VOICEMAIL", statusKey: "CALL_COMPLETED", label: "Voicemail" },
  { filter: "WRONG_NUMBER", statusKey: "WRONG_NUMBER", label: "Wrong Number" },
  { filter: "GATEKEEPER", statusKey: "GATEKEEPER_BLOCKED", label: "Gatekeeper" },
  { filter: "CONNECTED", statusKey: "CONNECTED", label: "Spoke" },
  { filter: "NOT_INTERESTED", statusKey: "NOT_INTERESTED", label: "Not Interested" },
  { filter: "MEETINGS", statusKey: "MEETING_BOOKED", label: "Meeting Booked" },
];
