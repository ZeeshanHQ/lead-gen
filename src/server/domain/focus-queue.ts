/**
 * Focus Stream & Automated Follow-Up Enforcement Engine (Pure Domain Logic).
 *
 * Designed for 10,000+ lead scale and zero-friction cold caller psychology:
 * 1. Mandatory Follow-Up Enforcement ("Zero-Escape Loop"):
 *    - Any lead with a due/overdue follow-up hijacks the #1 slot in the caller's stream.
 *    - Every non-terminal call outcome automatically computes a smart next-action timestamp
 *      so no lead ever sits in limbo without a scheduled next touch.
 * 2. Prospect Local Timezone & Golden Window Routing:
 *    - Uses the US state timezone mapping from `call-time.ts` to prioritize prospects
 *      who are currently in their prime local pickup window (or early/late gatekeeper bypass window).
 * 3. 3-Bullet Flash Battlecard & Live Objection Playbook:
 *    - Condenses long AI research summaries into 3 instant visual bullets + 1-tap objection counters.
 */

import {
  deriveCallStatus,
  extractFollowUp,
  parseCallLog,
  parseNoteTimestamp,
  type CallOutcomeKey,
  type CallStatusKey,
} from "./call-outcomes";
import {
  CALLER_TIMEZONE,
  DEFAULT_PROSPECT_TZ,
  formatFollowUpPkt,
  isWithinProspectBusinessHours,
  parseFollowUpMs,
  prospectBusinessDayAtMs,
  wallClock,
  zoneForState,
} from "./call-time";

export type LocalWindowStatus =
  | "PRIME_WINDOW"
  | "GATEKEEPER_BYPASS"
  | "LUNCH_DIP"
  | "AFTER_HOURS"
  | "UNKNOWN_TZ";

export interface ProspectLocalTimeInfo {
  tzGroupId: string | null;
  iana: string | null;
  localHour: number | null;
  localMinute: number | null;
  localTimeFormatted: string;
  windowStatus: LocalWindowStatus;
  windowLabel: string;
  windowScoreBoost: number;
}

/**
 * Computes the prospect's real-time local wall clock and calling window suitability.
 */
export function computeProspectLocalTimeInfo(
  state: string | null | undefined,
  nowMs: number = Date.now()
): ProspectLocalTimeInfo {
  const zone = zoneForState(state);
  if (!zone) {
    return {
      tzGroupId: null,
      iana: null,
      localHour: null,
      localMinute: null,
      localTimeFormatted: "US Local",
      windowStatus: "UNKNOWN_TZ",
      windowLabel: "Standard Business Window",
      windowScoreBoost: 15,
    };
  }

  const { hour, minute } = wallClock(nowMs, zone.iana);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const displayMin = String(minute).padStart(2, "0");
  const localTimeFormatted = `${displayHour}:${displayMin} ${ampm} ${zone.groupId}`;

  const decimalHour = hour + minute / 60;

  // Prime pickup windows: 8:45 AM - 11:30 AM and 1:30 PM - 4:30 PM local time
  if ((decimalHour >= 8.75 && decimalHour < 11.5) || (decimalHour >= 13.5 && decimalHour < 16.5)) {
    return {
      tzGroupId: zone.groupId,
      iana: zone.iana,
      localHour: hour,
      localMinute: minute,
      localTimeFormatted,
      windowStatus: "PRIME_WINDOW",
      windowLabel: `${localTimeFormatted} • Prime Pickup Window`,
      windowScoreBoost: 45,
    };
  }

  // Gatekeeper Bypass Windows: 7:45 AM - 8:45 AM and 4:30 PM - 5:45 PM local time
  // (Owners are at their desk or answering cell transfer before/after receptionists work)
  if ((decimalHour >= 7.75 && decimalHour < 8.75) || (decimalHour >= 16.5 && decimalHour <= 17.75)) {
    return {
      tzGroupId: zone.groupId,
      iana: zone.iana,
      localHour: hour,
      localMinute: minute,
      localTimeFormatted,
      windowStatus: "GATEKEEPER_BYPASS",
      windowLabel: `${localTimeFormatted} • Owner Direct / GK Bypass Hour`,
      windowScoreBoost: 38,
    };
  }

  // Lunch Window: 11:30 AM - 1:30 PM local time
  if (decimalHour >= 11.5 && decimalHour < 13.5) {
    return {
      tzGroupId: zone.groupId,
      iana: zone.iana,
      localHour: hour,
      localMinute: minute,
      localTimeFormatted,
      windowStatus: "LUNCH_DIP",
      windowLabel: `${localTimeFormatted} • Midday / Lunch Hour`,
      windowScoreBoost: 15,
    };
  }

  // After Hours: before 7:45 AM or after 5:45 PM local time
  return {
    tzGroupId: zone.groupId,
    iana: zone.iana,
    localHour: hour,
    localMinute: minute,
    localTimeFormatted,
    windowStatus: "AFTER_HOURS",
    windowLabel: `${localTimeFormatted} • Outside Standard Hours`,
    windowScoreBoost: -40,
  };
}

/**
 * Formats a Date into the stored follow-up string (`YYYY-MM-DDTHH:mm`, always CALLER/PKT time).
 * Kept under its historical name; it no longer depends on the machine's own timezone.
 */
export function formatFollowUpIsoLocal(date: Date): string {
  return formatFollowUpPkt(date.getTime());
}

export interface AutoCadenceResult {
  nextFollowUpIso: string | null;
  cadenceReason: string;
  isTerminal: boolean;
}

/**
 * Closed-Loop Auto-Cadence Engine.
 * Suggests the next retry for a lead. Every time is chosen on the PROSPECT's clock
 * (US business hours, weekdays only) and stored in PKT.
 */
export function computeAutoFollowUpCadence(input: {
  outcome: CallOutcomeKey;
  previousAttempts: number;
  explicitFollowUpDate?: string | null;
  /** Prospect state (TX, CA ...) used to pick the right US time zone. */
  state?: string | null;
  nowMs?: number;
}): AutoCadenceResult {
  const nowMs = input.nowMs ?? Date.now();
  const explicit = (input.explicitFollowUpDate || "").trim();
  const tz = zoneForState(input.state)?.iana ?? DEFAULT_PROSPECT_TZ;
  const at = (days: number, hour: number, minute = 0) =>
    formatFollowUpPkt(prospectBusinessDayAtMs(nowMs, tz, days, hour, minute));

  // Terminal outcomes: remove from active calling retry loop and clear all follow-ups
  if (
    input.outcome === "NOT_INTERESTED" ||
    input.outcome === "WRONG_NUMBER" ||
    input.outcome === "MEETING_BOOKED"
  ) {
    return {
      nextFollowUpIso: null,
      cadenceReason: "Closed outcome — removed from retry queue",
      isTerminal: true,
    };
  }

  if (explicit) {
    return {
      nextFollowUpIso: explicit,
      cadenceReason: "Manual follow-up scheduled by caller",
      isTerminal: false,
    };
  }

  const attemptNum = Math.max(1, input.previousAttempts + 1);

  // Max 6 attempts on unresponsive leads before resting for a week
  if (
    attemptNum >= 6 &&
    (input.outcome === "NO_ANSWER" || input.outcome === "CALL_COMPLETED")
  ) {
    return {
      nextFollowUpIso: at(7, 10),
      cadenceReason: "Attempt 6 reached — moved to 7-day low-priority nurture",
      isTerminal: false,
    };
  }

  // Connected with Decision Maker: never leave an open conversation without a next touch
  if (input.outcome === "CONNECTED") {
    return {
      nextFollowUpIso: at(1, 10),
      cadenceReason: "Auto-protected owner conversation (next business day 10:00 AM prospect time)",
      isTerminal: false,
    };
  }

  // Gatekeeper: alternate the owner-direct windows (early morning / late afternoon)
  if (input.outcome === "GATEKEEPER_BLOCKED") {
    const days = attemptNum === 1 ? 1 : 2;
    return {
      nextFollowUpIso: attemptNum % 2 === 1 ? at(days, 8, 15) : at(days, 16, 45),
      cadenceReason: "Auto-scheduled for Gatekeeper Bypass window",
      isTerminal: false,
    };
  }

  // Left Voicemail: give 48 hours for a callback before the next touch
  if (input.outcome === "CALL_COMPLETED") {
    return {
      nextFollowUpIso: at(2, 10, 30),
      cadenceReason: "Voicemail cadence (+48h follow-up)",
      isTerminal: false,
    };
  }

  // No Answer:
  //   Attempt 1 -> +4 hours if that is still business hours, otherwise next business morning
  //   Attempt 2 -> next business day (afternoon)
  //   Attempt 3+ -> +2 days
  if (attemptNum === 1) {
    const fourHours = nowMs + 4 * 3600_000;
    const slot = isWithinProspectBusinessHours(fourHours, tz)
      ? formatFollowUpPkt(fourHours)
      : at(1, 9, 30);
    return {
      nextFollowUpIso: slot,
      cadenceReason: "Attempt 1 No-Answer -> +4h time-shift retry",
      isTerminal: false,
    };
  }

  const daysOut = attemptNum === 2 ? 1 : 2;
  return {
    nextFollowUpIso: attemptNum % 2 === 0 ? at(daysOut, 15) : at(daysOut, 10, 30),
    cadenceReason: `Attempt ${attemptNum} No-Answer -> +${daysOut}d cadence retry`,
    isTerminal: false,
  };
}

export type FocusPriorityTier =
  | "MANDATORY_FOLLOW_UP_DUE"
  | "UPCOMING_FOLLOW_UP"
  | "SCHEDULED_FOLLOW_UP"
  | "PRIME_WINDOW_FRESH"
  | "CADENCE_RETRY_DUE"
  | "STANDARD_QUEUE";

export interface RankedFocusLead<T> {
  lead: T;
  priorityScore: number;
  tier: FocusPriorityTier;
  reasonBadge: string;
  isMandatoryFollowUpLock: boolean;
  /**
   * True for callbacks scheduled further out than the "upcoming" window. They are kept in the
   * ranked list (so the Callbacks tab shows every scheduled callback) but are not offered in
   * the normal dialing stream until they are due.
   */
  isHeldBack: boolean;
  overdueMinutes: number;
  followUpIso: string | null;
  derivedStatus: CallStatusKey;
  attempts: number;
  localTime: ProspectLocalTimeInfo;
  shiftBucket?: "FOLLOW_UP" | "FRESH" | "RETRY";
  shiftSlotBadge?: string;
  isDirectOwnerCallback?: boolean;
}

/**
 * Ranks a caller's lead pool into an intelligent, single-file "Spotify Playlist" stream.
 * - Overdue & due-now follow-ups are strictly locked at the top (`isMandatoryFollowUpLock = true`).
 * - Fresh leads in their Prime Local Window with high ICP / Ad Spend signals come next.
 * - Scheduled cadence retries whose retry time has arrived come next.
 * - Future callbacks are never dropped: they are returned with `isHeldBack = true`.
 */
export function rankLeadsForFocusStream<
  T extends {
    companyId?: string;
    id?: string;
    name: string;
    state?: string | null;
    status?: string | null;
    icpScore?: number | null;
    notes?: string | null;
    facts?: Record<string, any> | null;
    nextFollowUp?: string | null;
    approvedAt?: string | Date | null;
    createdAt?: string | Date | null;
  }
>(leads: T[], nowMs: number = Date.now()): RankedFocusLead<T>[] {
  const ranked: RankedFocusLead<T>[] = [];

  for (const lead of leads) {
    const derived = deriveCallStatus(lead);
    // Exclude terminal / closed-won / closed-lost leads from the active calling stream
    if (
      lead.status === "REJECTED" ||
      lead.status === "LOST" ||
      lead.status === "MEETING_BOOKED" ||
      lead.status === "QUALIFIED" ||
      derived.key === "MEETING_BOOKED" ||
      derived.key === "NOT_INTERESTED" ||
      derived.key === "WRONG_NUMBER"
    ) {
      continue;
    }

    const localTime = computeProspectLocalTimeInfo(lead.state, nowMs);
    const followUpRaw = lead.nextFollowUp || extractFollowUp(lead.notes);
    const parsedFollowUp = parseFollowUpMs(followUpRaw);
    const hasValidFollowUp = parsedFollowUp !== null;
    const followUpMs = parsedFollowUp ?? NaN;

    const icp = lead.icpScore ?? 60;
    const facts = lead.facts || {};
    const hasAdSpendSignal =
      facts["bleeding_ads"] === "YES" ||
      facts["google_ads"] === "YES" ||
      facts["zillow_advertiser"] === "YES";
    const adBonus = hasAdSpendSignal ? 18 : 0;

    const base = {
      lead,
      derivedStatus: derived.key,
      attempts: derived.attempts,
      localTime,
    };

    // TIER 1: Mandatory Follow-Up Due Now or Overdue (Grace window: due within next 5 mins)
    if (hasValidFollowUp && followUpMs <= nowMs + 5 * 60_000) {
      const overdueMinutes = Math.max(0, Math.round((nowMs - followUpMs) / 60_000));
      ranked.push({
        ...base,
        priorityScore: 100_000 + Math.min(5_000, overdueMinutes) + icp + adBonus,
        tier: "MANDATORY_FOLLOW_UP_DUE",
        reasonBadge:
          overdueMinutes > 60
            ? `Follow-Up Overdue (${Math.floor(overdueMinutes / 60)}h ${overdueMinutes % 60}m)`
            : overdueMinutes > 0
            ? `Follow-Up Due (${overdueMinutes}m ago)`
            : "Follow-Up Due Now",
        isMandatoryFollowUpLock: true,
        isHeldBack: false,
        overdueMinutes,
        followUpIso: followUpRaw,
      });
      continue;
    }

    // TIER 2: Follow-Up Coming Up Soon (within next 45 mins)
    if (hasValidFollowUp && followUpMs <= nowMs + 45 * 60_000) {
      const minsUntil = Math.max(1, Math.round((followUpMs - nowMs) / 60_000));
      ranked.push({
        ...base,
        priorityScore: 50_000 - minsUntil * 10 + icp,
        tier: "UPCOMING_FOLLOW_UP",
        reasonBadge: `Callback in ${minsUntil}m`,
        isMandatoryFollowUpLock: false,
        isHeldBack: false,
        overdueMinutes: 0,
        followUpIso: followUpRaw,
      });
      continue;
    }

    // TIER 2.5: Callback scheduled for later. Never dropped: it stays visible in the Callbacks
    // tab, it just is not offered in the dialing stream until it is due.
    if (hasValidFollowUp) {
      const minsUntil = Math.round((followUpMs - nowMs) / 60_000);
      ranked.push({
        ...base,
        priorityScore: 1_000 - Math.min(900, Math.floor(minsUntil / 60)),
        tier: "SCHEDULED_FOLLOW_UP",
        reasonBadge: "Scheduled Callback",
        isMandatoryFollowUpLock: false,
        isHeldBack: true,
        overdueMinutes: 0,
        followUpIso: followUpRaw,
      });
      continue;
    }

    // TIER 3: Untouched Leads in Prime / Gatekeeper-Bypass Local Window
    if (derived.key === "UNTOUCHED") {
      const score = 10_000 + localTime.windowScoreBoost * 20 + icp * 3 + adBonus;
      const tier: FocusPriorityTier =
        localTime.windowStatus === "PRIME_WINDOW" ||
        localTime.windowStatus === "GATEKEEPER_BYPASS"
          ? "PRIME_WINDOW_FRESH"
          : "STANDARD_QUEUE";

      const badge =
        localTime.windowStatus === "PRIME_WINDOW"
          ? `Prime Local Window (${localTime.localTimeFormatted})`
          : localTime.windowStatus === "GATEKEEPER_BYPASS"
          ? `Owner Direct Window (${localTime.localTimeFormatted})`
          : hasAdSpendSignal
          ? "Active Paid Ads Signal"
          : `Fresh Verified Lead (${icp}/100)`;

      ranked.push({
        ...base,
        priorityScore: score,
        tier,
        reasonBadge: badge,
        isMandatoryFollowUpLock: false,
        isHeldBack: false,
        overdueMinutes: 0,
        followUpIso: null,
        attempts: 0,
      });
      continue;
    }

    // TIER 4: Previously Dialed Unreached Leads Eligible for Retry
    // Exclude CONNECTED leads without a scheduled follow-up (already spoke with decision maker)
    // and ensure at least 1 call attempt was logged.
    if (derived.key === "CONNECTED" || derived.attempts <= 0) {
      continue;
    }

    const lastCallMs = derived.lastLog?.timestampRaw
      ? parseNoteTimestamp(derived.lastLog.timestampRaw, nowMs)
      : null;
    const recentDialCooldownPenalty =
      lastCallMs !== null && nowMs - lastCallMs < 3 * 3600_000 ? 1_500 : 0;
    const retryPenalty = derived.attempts * 45 + recentDialCooldownPenalty;
    const retryScore = 4_000 + localTime.windowScoreBoost * 15 + icp * 2 + adBonus - retryPenalty;
    ranked.push({
      ...base,
      priorityScore: retryScore,
      tier: "CADENCE_RETRY_DUE",
      reasonBadge: `${derived.attempts} ${derived.attempts === 1 ? "Call" : "Calls"} Logged (${derived.def.label})`,
      isMandatoryFollowUpLock: false,
      isHeldBack: false,
      overdueMinutes: 0,
      followUpIso: null,
    });
  }

  return ranked.sort((a, b) => b.priorityScore - a.priorityScore);
}

export interface FlashBattlecard {
  painTrigger: string;
  scaleAndTech: string;
  gatekeeperTip: string;
  scripts: {
    OPENING: string;
    GATEKEEPER: string;
    OBJ_BUSY: string;
    OBJ_CURRENT_SYSTEM: string;
    OBJ_SEND_EMAIL: string;
    OBJ_PRICE: string;
  };
}

/**
 * Generates a scannable 3-Bullet Flash Battlecard + Instant Objection Switcher
 * so callers never read walls of text while the phone is ringing.
 */
export function buildFlashBattlecard(input: {
  companyName: string;
  contactName?: string | null;
  contactTitle?: string | null;
  city?: string | null;
  state?: string | null;
  nicheName?: string;
  software?: string | null;
  financing?: string | null;
  replacement?: string | null;
  facts?: Record<string, string> | null;
  researchSummary?: string | null;
  openingScript: string;
}): FlashBattlecard {
  const firstName = input.contactName ? input.contactName.trim().split(/\s+/)[0] : null;
  const dmDisplay = firstName || "the owner";
  const location = [input.city, input.state].filter(Boolean).join(", ") || "your area";
  const facts = input.facts || {};

  // 1. Pain Trigger Bullet (Hyper-personalized to Real Estate / PM / STR / Brokerage)
  const nicheLower = `${input.nicheName || ""} ${input.researchSummary || ""} ${Object.values(facts).join(" ")}`.toLowerCase();
  const isStr = /\b(str|airbnb|vrbo|vacation\s*rental|short[- ]term|guest|guesty|hostaway)\b/i.test(nicheLower);
  const isPm = /\b(property\s*management|doors|tenant|leasing|appfolio|buildium|yardi|rent\s*manager)\b/i.test(nicheLower);
  const doorsCount = facts["doors_managed"] || null;
  const swName = input.software && input.software !== "UNKNOWN" ? input.software.toUpperCase() : null;

  let painTrigger = isStr
    ? `Late-night guest & direct-booking inquiries in ${location} go unanswered after 6 PM, losing high-margin direct bookings to Airbnb/OTAs.`
    : isPm
    ? `Owner-acquisition & tenant leasing calls in ${location} hit voicemail during peak hours${doorsCount ? ` across ${doorsCount} doors` : ""}.`
    : `Inbound Zillow/Realtor & buyer/seller calls in ${location} wait hours for callbacks — 78% list with the first broker who answers live.`;

  if (facts["google_ads"] === "YES" || facts["bleeding_ads"] === "YES") {
    painTrigger = `Active paid ad traffic in ${location}: missed inbound calls leak high-commission management & listing deals.`;
  }

  // 2. Scale & Tech Bullet
  const techParts: string[] = [];
  if (swName) {
    techParts.push(`Stack: ${swName}`);
  }
  if (doorsCount) {
    techParts.push(`${doorsCount} Doors Managed`);
  }
  if (facts["employees"]) {
    techParts.push(`${facts["employees"]} Staff`);
  }
  if (facts["avg_property_value"]) {
    techParts.push(facts["avg_property_value"]);
  }
  const scaleAndTech =
    techParts.length > 0
      ? techParts.join(" • ")
      : `Verified ${input.nicheName || "Real Estate"} Operator in ${location}`;

  // 3. Gatekeeper Strategy Bullet
  const gatekeeperTip = firstName
    ? `Say casually with downward inflection: "Hey, is ${firstName} in? It's regarding ${input.companyName}'s inbound owner & leasing line."`
    : `Ask casually: "Hey, who oversees new property owner intake at ${input.companyName}? Are they in?"`;

  const dynamicOpener = isStr
    ? `"Hey ${firstName || "there"}, I was looking at ${input.companyName}'s vacation rentals in ${location} — quick question: when a guest or property owner calls after hours, does someone pick up live in under 30 seconds, or does it roll to voicemail? We deploy a 24/7 AI Voice Concierge that answers every call live and books direct stays & owner consults on your calendar. Worth a 10-minute look this week?"`
    : isPm
    ? `"Hey ${firstName || "there"}, saw ${input.companyName} manages properties across ${location}${swName ? ` on ${swName}` : ""} — quick question: when a landlord or prospective tenant calls after 5 PM or while your team is on showings, who catches that call live? We plug a 24/7 AI Voice Concierge into your phone line that qualifies property owners and books consults directly on your calendar. Open to a 10-minute live demo Thursday?"`
    : input.openingScript;

  return {
    painTrigger,
    scaleAndTech,
    gatekeeperTip,
    scripts: {
      OPENING: dynamicOpener,
      GATEKEEPER: firstName
        ? `"Hey there — is ${firstName} available for 20 seconds? Just let them know it's regarding ${input.companyName}'s inbound owner & listing inquiries in ${location}."`
        : `"Hey there — who handles new owner & listing inquiries at ${input.companyName}? Are they available for 20 seconds?"`,
      OBJ_BUSY: `"Totally respect that, ${dmDisplay} — I'll be gone in 15 seconds. We install a 24/7 Voice AI Receptionist for ${location} ${isPm ? "property managers" : isStr ? "vacation rental operators" : "brokerages"} that answers missed calls in 2 rings, qualifies landlords/buyers, and books them straight onto your calendar. Worth a 10-minute live demo tomorrow, or is Thursday better?"`,
      OBJ_CURRENT_SYSTEM: `"That's actually why I reached out — we don't replace ${swName || "your current CRM or front desk"}. We only catch the overflow, evening, and weekend calls your team misses and push qualified appointments straight into ${swName || "your calendar"}. If it adds 2 to 4 extra signed management/listing agreements a month, would you be opposed to seeing a 5-minute demo?"`,
      OBJ_SEND_EMAIL: `"I'll send that right over to your inbox. So I send the exact 60-second voice demo relevant to ${input.companyName} — is your bigger priority right now signing more property owners/listings, or automating tenant & guest calls?"`,
      OBJ_PRICE: `"It costs less than a single lost management agreement or commission, and if it doesn't book qualified appointments in the first 30 days, you don't pay a cent. Let's do a 10-minute live test call where you can actually speak to the AI yourself — does tomorrow morning or afternoon work better?"`,
    },
  };
}

/**
 * 1-Tap Smart Note Chips per outcome: eliminates manual typing after 90% of calls.
 */
export function getQuickNoteChipsForOutcome(outcome: CallOutcomeKey): string[] {
  switch (outcome) {
    case "NO_ANSWER":
      return [
        "Rang 5x, no pickup",
        "Line busy, retry afternoon",
        "No voicemail setup",
        "Rang out on main line",
      ];
    case "CALL_COMPLETED":
      return [
        "Left 20s voicemail for owner",
        "Left VM with callback number",
        "Automated greeting, left message",
      ];
    case "GATEKEEPER_BLOCKED":
      return [
        "Owner in the field, call back afternoon",
        "Receptionist took message",
        "Owner in a meeting, try tomorrow morning",
        "Front desk asked to email info@",
      ];
    case "CONNECTED":
      return [
        "Spoke with owner, interested, call back tomorrow",
        "Owner on job site, asked to call later today",
        "Confirmed pain with missed after-hours calls",
        "Reviewing with partner, follow up in 2 days",
      ];
    case "MEETING_BOOKED":
      return [
        "15-min Zoom Demo booked with Owner!",
        "Calendar invite sent & confirmed on call",
        "High intent: wants 24/7 AI intake setup",
      ];
    case "NOT_INTERESTED":
      return [
        "Already has in-house system",
        "Not taking more volume right now",
        "Owner declined politely",
        "Requested DNC",
      ];
    case "WRONG_NUMBER":
      return [
        "Number disconnected",
        "Wrong business / residential line",
        "Fax tone",
      ];
  }
}

// ---------------------------------------------------------------------------
// Owner-Controlled Daily Shift Sequence & Auto-Mix Engine
// ---------------------------------------------------------------------------

export type ShiftPacingMode =
  | "AUTO_TIME_SEQUENCE"
  | "BALANCED_5_CALL"
  | "FRESH_POWER_HOUR"
  | "FOLLOW_UP_BLITZ"
  | "RETRY_CLEANUP"
  | "CUSTOM_RATIO";

export type NightShiftBlockId =
  | "BLOCK_1_EAST_OPEN"
  | "BLOCK_2_PRIME_OVERLAP"
  | "BLOCK_3_GK_BYPASS_WEST"
  | "PRE_SHIFT_PREP";

export interface NightShiftBlockInfo {
  blockId: NightShiftBlockId;
  pktHour: number;
  pktMinute: number;
  pktTimeFormatted: string;
  title: string;
  subtitle: string;
  recommendedWeights: { followUp: number; fresh: number; retry: number };
  focusTzGroups: string[];
}

export interface CallerShiftRule {
  enabled: boolean;
  mode: ShiftPacingMode;
  dailyQuotaDials: number;
  followUpDailyCap: number;
  freshDailyTarget: number;
  retryDailyTarget: number;
  followUpWeight: number;
  freshWeight: number;
  retryWeight: number;
  lockCallerToShiftMix: boolean;
  maxRetryAttempts: number;
  retryCooldownHours: number;
}

export interface CallerShiftConfig {
  defaultRule: CallerShiftRule;
  callerOverrides: Record<string, Partial<CallerShiftRule>>;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_CALLER_SHIFT_RULE: CallerShiftRule = {
  enabled: true,
  mode: "AUTO_TIME_SEQUENCE",
  dailyQuotaDials: 120,
  followUpDailyCap: 25,
  freshDailyTarget: 60,
  retryDailyTarget: 35,
  followUpWeight: 2,
  freshWeight: 2,
  retryWeight: 1,
  lockCallerToShiftMix: true,
  maxRetryAttempts: 6,
  retryCooldownHours: 4,
};

export const DEFAULT_CALLER_SHIFT_CONFIG: CallerShiftConfig = {
  defaultRule: DEFAULT_CALLER_SHIFT_RULE,
  callerOverrides: {},
};

const VALID_SHIFT_MODES = new Set<ShiftPacingMode>([
  "AUTO_TIME_SEQUENCE",
  "BALANCED_5_CALL",
  "FRESH_POWER_HOUR",
  "FOLLOW_UP_BLITZ",
  "RETRY_CLEANUP",
  "CUSTOM_RATIO",
]);

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Resolves the effective shift rule for a specific caller (or workspace default).
 */
export function resolveCallerShiftRule(
  config?: Partial<CallerShiftConfig> | null,
  callerId?: string | null
): CallerShiftRule {
  const base: CallerShiftRule = {
    ...DEFAULT_CALLER_SHIFT_RULE,
    ...(config?.defaultRule || {}),
  };
  const override =
    callerId &&
    callerId !== "ALL" &&
    callerId !== "UNASSIGNED" &&
    config?.callerOverrides &&
    config.callerOverrides[callerId]
      ? config.callerOverrides[callerId]
      : undefined;

  const merged: CallerShiftRule = {
    ...base,
    ...(override || {}),
  };

  let followUpWeight = clampInt(merged.followUpWeight, 0, 20, DEFAULT_CALLER_SHIFT_RULE.followUpWeight);
  let freshWeight = clampInt(merged.freshWeight, 0, 20, DEFAULT_CALLER_SHIFT_RULE.freshWeight);
  let retryWeight = clampInt(merged.retryWeight, 0, 20, DEFAULT_CALLER_SHIFT_RULE.retryWeight);
  if (followUpWeight + freshWeight + retryWeight === 0) {
    followUpWeight = 2;
    freshWeight = 2;
    retryWeight = 1;
  }

  return {
    enabled: merged.enabled !== false,
    mode: VALID_SHIFT_MODES.has(merged.mode) ? merged.mode : "AUTO_TIME_SEQUENCE",
    dailyQuotaDials: clampInt(merged.dailyQuotaDials, 10, 1000, DEFAULT_CALLER_SHIFT_RULE.dailyQuotaDials),
    followUpDailyCap: clampInt(merged.followUpDailyCap, 1, 500, DEFAULT_CALLER_SHIFT_RULE.followUpDailyCap),
    freshDailyTarget: clampInt(merged.freshDailyTarget, 0, 500, DEFAULT_CALLER_SHIFT_RULE.freshDailyTarget),
    retryDailyTarget: clampInt(merged.retryDailyTarget, 0, 500, DEFAULT_CALLER_SHIFT_RULE.retryDailyTarget),
    followUpWeight,
    freshWeight,
    retryWeight,
    lockCallerToShiftMix: merged.lockCallerToShiftMix !== false,
    maxRetryAttempts: clampInt(merged.maxRetryAttempts, 2, 15, DEFAULT_CALLER_SHIFT_RULE.maxRetryAttempts),
    retryCooldownHours: clampInt(merged.retryCooldownHours, 1, 48, DEFAULT_CALLER_SHIFT_RULE.retryCooldownHours),
  };
}

/**
 * Maps Pakistan Standard Time (PKT) night calling hours into 3 US-aligned shift blocks.
 */
export function computeActiveNightShiftBlock(nowMs: number = Date.now()): NightShiftBlockInfo {
  const { hour, minute } = wallClock(nowMs, CALLER_TIMEZONE);
  const ampm = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const pktTimeFormatted = `${displayHour}:${String(minute).padStart(2, "0")} ${ampm} PKT`;
  const decimalHour = hour + minute / 60;

  if (decimalHour >= 18 && decimalHour < 20.5) {
    return {
      blockId: "BLOCK_1_EAST_OPEN",
      pktHour: hour,
      pktMinute: minute,
      pktTimeFormatted,
      title: "Block 1 (6:00–8:30 PM PKT) • East/Central Warmup & Callbacks",
      subtitle: "US East & Central morning open — clear scheduled callbacks & warm ET/CT leads.",
      recommendedWeights: { followUp: 2, fresh: 2, retry: 1 },
      focusTzGroups: ["ET", "CT"],
    };
  }

  if (decimalHour >= 20.5 && decimalHour < 23.5) {
    return {
      blockId: "BLOCK_2_PRIME_OVERLAP",
      pktHour: hour,
      pktMinute: minute,
      pktTimeFormatted,
      title: "Block 2 (8:30–11:30 PM PKT) • All-US Golden Overlap",
      subtitle: "All 4 US timezones active — push Fresh high-ICP leads alongside Follow-Ups & Retries.",
      recommendedWeights: { followUp: 1, fresh: 3, retry: 1 },
      focusTzGroups: ["ET", "CT", "MT", "PT"],
    };
  }

  if (decimalHour >= 23.5 || decimalHour < 3) {
    return {
      blockId: "BLOCK_3_GK_BYPASS_WEST",
      pktHour: hour,
      pktMinute: minute,
      pktTimeFormatted,
      title: "Block 3 (11:30 PM–3:00 AM PKT) • Gatekeeper Bypass & West Coast",
      subtitle: "Late US afternoon (owners pick up direct) — focus Retry Pool & Pacific/Mountain leads.",
      recommendedWeights: { followUp: 1, fresh: 1, retry: 3 },
      focusTzGroups: ["CT", "MT", "PT"],
    };
  }

  return {
    blockId: "PRE_SHIFT_PREP",
    pktHour: hour,
    pktMinute: minute,
    pktTimeFormatted,
    title: "Night Shift Sequence Ready (Starts 6:00 PM PKT)",
    subtitle: "Balanced 5-call sequence active: 2 Follow-Ups → 2 Fresh Leads → 1 Retry Pool.",
    recommendedWeights: { followUp: 2, fresh: 2, retry: 1 },
    focusTzGroups: ["ET", "CT", "MT", "PT"],
  };
}

/**
 * Resolves the active Follow-Up : Fresh : Retry cycle weights from a shift rule.
 */
export function resolveEffectiveShiftWeights(
  rule: CallerShiftRule,
  nowMs: number = Date.now()
): { followUp: number; fresh: number; retry: number; cycleLength: number; modeLabel: string } {
  let followUp = 2;
  let fresh = 2;
  let retry = 1;
  let modeLabel = "Auto Night Sequence";

  switch (rule.mode) {
    case "AUTO_TIME_SEQUENCE": {
      const block = computeActiveNightShiftBlock(nowMs);
      followUp = block.recommendedWeights.followUp;
      fresh = block.recommendedWeights.fresh;
      retry = block.recommendedWeights.retry;
      modeLabel = `Auto (${followUp}F : ${fresh}N : ${retry}R)`;
      break;
    }
    case "BALANCED_5_CALL":
      followUp = 2;
      fresh = 2;
      retry = 1;
      modeLabel = "Balanced 5-Call (2:2:1)";
      break;
    case "FRESH_POWER_HOUR":
      followUp = 1;
      fresh = 3;
      retry = 1;
      modeLabel = "Fresh Power Hour (1:3:1)";
      break;
    case "FOLLOW_UP_BLITZ":
      followUp = 3;
      fresh = 1;
      retry = 1;
      modeLabel = "Follow-Up Blitz (3:1:1)";
      break;
    case "RETRY_CLEANUP":
      followUp = 1;
      fresh = 1;
      retry = 3;
      modeLabel = "Retry Cleanup (1:1:3)";
      break;
    case "CUSTOM_RATIO":
      followUp = rule.followUpWeight;
      fresh = rule.freshWeight;
      retry = rule.retryWeight;
      modeLabel = `Custom (${followUp}F : ${fresh}N : ${retry}R)`;
      break;
  }

  if (followUp + fresh + retry === 0) {
    followUp = 2;
    fresh = 2;
    retry = 1;
  }

  return {
    followUp,
    fresh,
    retry,
    cycleLength: followUp + fresh + retry,
    modeLabel,
  };
}

/**
 * Interleaves active Follow-Up, Fresh, and Retry pools according to the Owner's Shift Rule
 * with built-in anti-decay rotation so none of the three buckets (Follow-Ups, Fresh, Retries)
 * ever stagnate or go dead. Retains 100% of active callable leads (zero data loss).
 */
export function buildShiftSequenceStream<
  T extends {
    notes?: string | null;
    approvedAt?: string | Date | null;
    createdAt?: string | Date | null;
  }
>(
  rankedLeads: RankedFocusLead<T>[],
  rule: CallerShiftRule,
  nowMs: number = Date.now()
): RankedFocusLead<T>[] {
  const callable = rankedLeads.filter((r) => !r.isHeldBack);
  if (callable.length === 0) return [];

  if (!rule.enabled) {
    return callable.map((item) => {
      const isFu =
        item.tier === "MANDATORY_FOLLOW_UP_DUE" ||
        item.tier === "UPCOMING_FOLLOW_UP" ||
        Boolean(item.followUpIso);
      const bucket: "FOLLOW_UP" | "FRESH" | "RETRY" = isFu
        ? "FOLLOW_UP"
        : item.derivedStatus === "UNTOUCHED"
        ? "FRESH"
        : "RETRY";
      return { ...item, shiftBucket: bucket };
    });
  }

  const block = computeActiveNightShiftBlock(nowMs);
  const focusTzSet = new Set(block.focusTzGroups);

  const followUpPool: RankedFocusLead<T>[] = [];
  const freshPool: RankedFocusLead<T>[] = [];
  const rawRetryPool: RankedFocusLead<T>[] = [];

  for (const item of callable) {
    const isFu =
      item.tier === "MANDATORY_FOLLOW_UP_DUE" ||
      item.tier === "UPCOMING_FOLLOW_UP" ||
      Boolean(item.followUpIso);
    if (isFu) {
      followUpPool.push(item);
    } else if (item.derivedStatus === "UNTOUCHED") {
      freshPool.push(item);
    } else {
      rawRetryPool.push(item);
    }
  }

  // 1. Follow-Up Anti-Starvation Sort:
  //    True owner-connected conversations always go first. Remaining follow-ups alternate
  //    between newest/highest-priority due callbacks and oldest overdue at-risk callbacks
  //    so accumulated follow-ups (e.g. 66) never starve at the bottom.
  followUpPool.sort((a, b) => {
    const aConn = a.derivedStatus === "CONNECTED" ? 1 : 0;
    const bConn = b.derivedStatus === "CONNECTED" ? 1 : 0;
    if (aConn !== bConn) return bConn - aConn;
    return b.priorityScore - a.priorityScore;
  });

  const connectedDue = followUpPool.filter(
    (r) => r.derivedStatus === "CONNECTED" && r.tier === "MANDATORY_FOLLOW_UP_DUE"
  );
  const rawOtherFollowUps = followUpPool.filter(
    (r) => !(r.derivedStatus === "CONNECTED" && r.tier === "MANDATORY_FOLLOW_UP_DUE")
  );
  const byOldestOverdue = [...rawOtherFollowUps].sort(
    (a, b) => b.overdueMinutes - a.overdueMinutes || b.priorityScore - a.priorityScore
  );
  const otherFollowUps: RankedFocusLead<T>[] = [];
  const seenFu = new Set<RankedFocusLead<T>>();
  let idxPriority = 0;
  let idxOldest = 0;
  while (otherFollowUps.length < rawOtherFollowUps.length) {
    while (idxPriority < rawOtherFollowUps.length && seenFu.has(rawOtherFollowUps[idxPriority]!)) {
      idxPriority++;
    }
    if (idxPriority < rawOtherFollowUps.length) {
      const pick = rawOtherFollowUps[idxPriority++]!;
      seenFu.add(pick);
      otherFollowUps.push(pick);
    }
    while (idxOldest < byOldestOverdue.length && seenFu.has(byOldestOverdue[idxOldest]!)) {
      idxOldest++;
    }
    if (idxOldest < byOldestOverdue.length) {
      const pick = byOldestOverdue[idxOldest++]!;
      seenFu.add(pick);
      otherFollowUps.push(pick);
    }
  }

  const remainingCap = Math.max(0, rule.followUpDailyCap - connectedDue.length);
  const primaryFollowUps = [...connectedDue, ...otherFollowUps.slice(0, remainingCap)];
  const overflowFollowUps = otherFollowUps.slice(remainingCap);

  // 2. Fresh Pool Anti-Decay Sort:
  //    Boosts untouched leads older than 3 days so older fresh inventory never rots while
  //    preserving Prime Local Window + PKT Night Block timezone fit.
  const freshScore = (item: RankedFocusLead<T>) => {
    const refDate = item.lead.approvedAt || item.lead.createdAt;
    const refMs = refDate ? new Date(refDate).getTime() : NaN;
    const ageDays = Number.isFinite(refMs) ? Math.max(0, (nowMs - refMs) / 86_400_000) : 0;
    const agingBoost = ageDays >= 3 ? Math.min(2500, Math.floor(ageDays - 2) * 400) : 0;
    const tzBoost =
      rule.mode === "AUTO_TIME_SEQUENCE" &&
      item.localTime.tzGroupId &&
      focusTzSet.has(item.localTime.tzGroupId)
        ? 150
        : 0;
    return item.priorityScore + agingBoost + tzBoost;
  };
  freshPool.sort((a, b) => freshScore(b) - freshScore(a));

  // 3. Retry Pool Anti-Bloat & Anti-Decay Partition:
  //    - Active Ready Retries: past same-shift cooldown & below maxRetryAttempts (or past 7-day rest).
  //      Ordered by local calling window + anti-decay staleness boost so older retries don't die.
  //    - Cooled-Down Retries: dialed within the last `retryCooldownHours` (pushed behind ready retries).
  //    - Resting Retries: `attempts >= maxRetryAttempts` dialed within 7 days (rested at tail, zero data loss).
  const readyRetries: RankedFocusLead<T>[] = [];
  const cooledDownRetries: RankedFocusLead<T>[] = [];
  const restingRetries: RankedFocusLead<T>[] = [];
  const retryHoursMap = new Map<RankedFocusLead<T>, number>();

  for (const item of rawRetryPool) {
    const lastLog = parseCallLog(item.lead.notes)[0];
    const lastCallMs = lastLog?.timestampRaw
      ? parseNoteTimestamp(lastLog.timestampRaw, nowMs)
      : null;
    const hoursSinceLast =
      lastCallMs !== null ? Math.max(0, (nowMs - lastCallMs) / 3600_000) : 48;
    retryHoursMap.set(item, hoursSinceLast);

    if (item.attempts >= rule.maxRetryAttempts && hoursSinceLast < 7 * 24) {
      restingRetries.push(item);
    } else if (hoursSinceLast < rule.retryCooldownHours) {
      cooledDownRetries.push(item);
    } else {
      readyRetries.push(item);
    }
  }

  const retryEffectiveScore = (item: RankedFocusLead<T>) => {
    const hoursSinceLast = retryHoursMap.get(item) ?? 24;
    const stalenessBoost =
      hoursSinceLast >= 24 ? Math.min(2400, Math.floor(hoursSinceLast / 24) * 450) : 0;
    const tzBoost =
      rule.mode === "AUTO_TIME_SEQUENCE" &&
      item.localTime.tzGroupId &&
      focusTzSet.has(item.localTime.tzGroupId)
        ? 120
        : 0;
    return item.priorityScore + stalenessBoost + tzBoost;
  };
  readyRetries.sort((a, b) => retryEffectiveScore(b) - retryEffectiveScore(a));
  cooledDownRetries.sort((a, b) => retryEffectiveScore(b) - retryEffectiveScore(a));
  restingRetries.sort((a, b) => retryEffectiveScore(b) - retryEffectiveScore(a));

  const retryPool = [...readyRetries, ...cooledDownRetries];

  const weights = resolveEffectiveShiftWeights(rule, nowMs);
  const result: RankedFocusLead<T>[] = [];

  let fuIdx = 0;
  let frIdx = 0;
  let rtIdx = 0;

  while (
    fuIdx < primaryFollowUps.length ||
    frIdx < freshPool.length ||
    rtIdx < retryPool.length
  ) {
    let slotInCycle = 0;
    const roundItems: Array<{
      item: RankedFocusLead<T>;
      bucket: "FOLLOW_UP" | "FRESH" | "RETRY";
      label: string;
    }> = [];

    for (let i = 0; i < weights.followUp && fuIdx < primaryFollowUps.length; i++) {
      roundItems.push({
        item: primaryFollowUps[fuIdx++]!,
        bucket: "FOLLOW_UP",
        label: "Follow-Up",
      });
    }
    for (let i = 0; i < weights.fresh && frIdx < freshPool.length; i++) {
      roundItems.push({
        item: freshPool[frIdx++]!,
        bucket: "FRESH",
        label: "Fresh Lead",
      });
    }
    for (let i = 0; i < weights.retry && rtIdx < retryPool.length; i++) {
      roundItems.push({
        item: retryPool[rtIdx++]!,
        bucket: "RETRY",
        label: "Retry Pool",
      });
    }

    if (roundItems.length === 0) break;

    const denom = Math.max(weights.cycleLength, roundItems.length);
    for (const entry of roundItems) {
      slotInCycle++;
      const isDirectOwnerCb =
        entry.bucket === "FOLLOW_UP" &&
        entry.item.derivedStatus === "CONNECTED" &&
        entry.item.tier === "MANDATORY_FOLLOW_UP_DUE";

      result.push({
        ...entry.item,
        isMandatoryFollowUpLock: isDirectOwnerCb,
        isDirectOwnerCallback: isDirectOwnerCb,
        shiftBucket: entry.bucket,
        shiftSlotBadge: `Shift Mix • ${entry.label} (${slotInCycle}/${denom})`,
      });
    }
  }

  for (const overflowItem of overflowFollowUps) {
    result.push({
      ...overflowItem,
      isMandatoryFollowUpLock: false,
      isDirectOwnerCallback: false,
      shiftBucket: "FOLLOW_UP",
      shiftSlotBadge: "Shift Mix • Follow-Up Overflow",
    });
  }

  for (const restingItem of restingRetries) {
    result.push({
      ...restingItem,
      isMandatoryFollowUpLock: false,
      isDirectOwnerCallback: false,
      shiftBucket: "RETRY",
      shiftSlotBadge: `Shift Mix • Retry Rest (${restingItem.attempts}+ calls)`,
    });
  }

  return result;
}

export interface CallerShiftSummary {
  totalPool: number;
  totalFollowUps: number;
  dueFollowUps: number;
  agingFollowUps: number;
  connectedCallbacks: number;
  todayFollowUpQuota: number;
  totalFresh: number;
  agingFresh: number;
  todayFreshQuota: number;
  totalRetries: number;
  agingRetries: number;
  restingRetries: number;
  todayRetryQuota: number;
  dailyQuotaDials: number;
  dialedTodayTotal: number;
  followUpsDoneToday: number;
  freshDoneToday: number;
  retriesDoneToday: number;
  meetingsToday: number;
}

/**
 * Computes live shift pool breakdown and current-shift dial progress for a caller's lead list.
 */
export function computeCallerShiftSummary(
  leads: Array<{
    status?: string | null;
    notes?: string | null;
    facts?: Record<string, any> | null;
    nextFollowUp?: string | null;
    approvedAt?: string | Date | null;
    createdAt?: string | Date | null;
  }>,
  rule: CallerShiftRule,
  nowMs: number = Date.now()
): CallerShiftSummary {
  let totalPool = 0;
  let totalFollowUps = 0;
  let dueFollowUps = 0;
  let agingFollowUps = 0;
  let connectedCallbacks = 0;
  let totalFresh = 0;
  let agingFresh = 0;
  let totalRetries = 0;
  let agingRetries = 0;
  let restingRetries = 0;

  let dialedTodayTotal = 0;
  let followUpsDoneToday = 0;
  let freshDoneToday = 0;
  let retriesDoneToday = 0;
  let meetingsToday = 0;

  // 14-hour rolling window captures full PKT night shifts across midnight without resetting mid-shift
  const shiftWindowStartMs = nowMs - 14 * 3600_000;

  for (const lead of leads) {
    if (lead.status === "REJECTED") continue;
    totalPool++;

    const derived = deriveCallStatus(lead);
    const logs = parseCallLog(lead.notes);
    const fuRaw = lead.nextFollowUp || extractFollowUp(lead.notes);
    const fuMs = parseFollowUpMs(fuRaw);

    const isTerminal =
      lead.status === "LOST" ||
      lead.status === "MEETING_BOOKED" ||
      lead.status === "QUALIFIED" ||
      derived.key === "MEETING_BOOKED" ||
      derived.key === "NOT_INTERESTED" ||
      derived.key === "WRONG_NUMBER";

    if (!isTerminal) {
      if (fuMs !== null) {
        totalFollowUps++;
        if (fuMs <= nowMs + 45 * 60_000) {
          dueFollowUps++;
        }
        if (fuMs < nowMs - 48 * 3600_000) {
          agingFollowUps++;
        }
        if (derived.key === "CONNECTED") {
          connectedCallbacks++;
        }
      } else if (derived.key === "UNTOUCHED") {
        totalFresh++;
        const refDate = lead.approvedAt || lead.createdAt;
        const refMs = refDate ? new Date(refDate).getTime() : NaN;
        if (Number.isFinite(refMs) && nowMs - refMs >= 3 * 86_400_000) {
          agingFresh++;
        }
      } else if (derived.key !== "CONNECTED" && derived.attempts > 0) {
        totalRetries++;
        const lastLog = logs[0];
        const lastCallMs = lastLog?.timestampRaw
          ? parseNoteTimestamp(lastLog.timestampRaw, nowMs)
          : null;
        const hoursSinceLast =
          lastCallMs !== null ? Math.max(0, (nowMs - lastCallMs) / 3600_000) : 48;
        if (derived.attempts >= rule.maxRetryAttempts && hoursSinceLast < 7 * 24) {
          restingRetries++;
        } else if (hoursSinceLast >= 48) {
          agingRetries++;
        }
      }
    }

    for (let i = 0; i < logs.length; i++) {
      const entry = logs[i]!;
      const logMs = entry.timestampRaw ? parseNoteTimestamp(entry.timestampRaw, nowMs) : null;
      if (logMs === null || logMs < shiftWindowStartMs || logMs > nowMs + 60_000) continue;

      dialedTodayTotal++;
      if (entry.outcome === "MEETING_BOOKED") {
        meetingsToday++;
      }

      if (i === logs.length - 1) {
        freshDoneToday++;
      } else {
        const prevOutcome = logs[i + 1]?.outcome;
        if (prevOutcome === "CONNECTED" || prevOutcome === "GATEKEEPER_BLOCKED" || fuMs !== null) {
          followUpsDoneToday++;
        } else {
          retriesDoneToday++;
        }
      }
    }
  }

  return {
    totalPool,
    totalFollowUps,
    dueFollowUps,
    agingFollowUps,
    connectedCallbacks,
    todayFollowUpQuota: Math.min(totalFollowUps, rule.followUpDailyCap),
    totalFresh,
    agingFresh,
    todayFreshQuota: Math.min(totalFresh, rule.freshDailyTarget),
    totalRetries,
    agingRetries,
    restingRetries,
    todayRetryQuota: Math.min(Math.max(0, totalRetries - restingRetries), rule.retryDailyTarget),
    dailyQuotaDials: rule.dailyQuotaDials,
    dialedTodayTotal,
    followUpsDoneToday,
    freshDoneToday,
    retriesDoneToday,
    meetingsToday,
  };
}


