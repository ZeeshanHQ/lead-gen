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
  type CallOutcomeKey,
  type CallStatusKey,
} from "./call-outcomes";
import {
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
            ? `🔔 Follow-Up Overdue (${Math.floor(overdueMinutes / 60)}h ${overdueMinutes % 60}m)`
            : overdueMinutes > 0
            ? `🔔 Follow-Up Due (${overdueMinutes}m ago)`
            : "🔔 Follow-Up Due Right Now",
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
        reasonBadge: `⏰ Callback in ${minsUntil}m`,
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
        reasonBadge: "📅 Scheduled Callback",
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
          ? `⚡ Prime Local Window (${localTime.localTimeFormatted})`
          : localTime.windowStatus === "GATEKEEPER_BYPASS"
          ? `🛡️ GK Bypass Hour (${localTime.localTimeFormatted})`
          : hasAdSpendSignal
          ? "🔥 High-Intent Ad Spender"
          : `🎯 Fresh Verified Lead (${icp}/100)`;

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

    // TIER 4: Previously Dialed Leads Eligible for Retry
    const retryPenalty = derived.attempts * 45;
    const retryScore = 4_000 + localTime.windowScoreBoost * 15 + icp * 2 + adBonus - retryPenalty;
    ranked.push({
      ...base,
      priorityScore: retryScore,
      tier: "CADENCE_RETRY_DUE",
      reasonBadge: `🔄 Retry Attempt #${derived.attempts + 1} (${derived.def.label})`,
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

  // 1. Pain Trigger Bullet
  let painTrigger = `Inbound inquiries and after-hours calls in ${location} wait hours for follow-up.`;
  if (facts["google_ads"] === "YES" && facts["zillow_advertiser"] === "YES") {
    painTrigger = "🔥 Active Google Ads and Zillow spend: uncalled after-hours inquiries leak high-value deals.";
  } else if (facts["google_ads"] === "YES" || facts["bleeding_ads"] === "YES") {
    painTrigger = "🔥 Active paid ad traffic detected: slow speed to lead costs high-ticket appointments.";
  } else if (input.financing === "YES" || input.replacement === "YES") {
    painTrigger = "High-ticket replacement and financing active: open bids require instant 24/7 follow-up.";
  }

  // 2. Scale & Tech Bullet
  const techParts: string[] = [];
  if (input.software && input.software !== "UNKNOWN") {
    techParts.push(`Tech: ${input.software.toUpperCase()}`);
  }
  if (facts["doors_managed"]) {
    techParts.push(`${facts["doors_managed"]} Doors Managed`);
  }
  if (facts["employees"]) {
    techParts.push(`${facts["employees"]} Team/Techs`);
  }
  if (facts["avg_property_value"]) {
    techParts.push(facts["avg_property_value"]);
  }
  const scaleAndTech =
    techParts.length > 0
      ? techParts.join(" • ")
      : `Established ${input.nicheName || "Local"} Operator in ${location}`;

  // 3. Gatekeeper Strategy Bullet
  const gatekeeperTip = firstName
    ? `Say casually: "Hey, is ${firstName} around? It's regarding the ${input.companyName} client intake setup."`
    : `Ask casually: "Hey, who handles new client intake over there? Is the owner in?"`;

  return {
    painTrigger,
    scaleAndTech,
    gatekeeperTip,
    scripts: {
      OPENING: input.openingScript,
      GATEKEEPER: firstName
        ? `"Hey there, is ${firstName} available for 30 seconds? Tell them it is ${
            input.nicheName ? "regarding their after-hours inquiry pipeline" : "a quick operations question"
          } for ${input.companyName}."`
        : `"Hey there, who is the best person to speak with regarding ${input.companyName}'s client scheduling? Are they in right now?"`,
      OBJ_BUSY: `"Totally get it, ${dmDisplay}, caught you right mid-day. Give me 15 seconds: we install a 24/7 AI intake engine that replies to missed calls and web leads in 10 seconds and books them on your calendar. Worth a 5-minute look this Thursday, or is Friday better?"`,
      OBJ_CURRENT_SYSTEM: `"That is actually why I called. Our engine plugs right alongside your existing CRM to catch the after-hours and weekend leads that slip through. If we could add 3 to 5 extra booked jobs a month without extra ad spend, would you be open to a quick walkthrough?"`,
      OBJ_SEND_EMAIL: `"Happy to shoot that over right now. Just so it is tailored: are you guys currently more focused on catching missed after-hours calls, or following up on open estimates automatically?"`,
      OBJ_PRICE: `"It is a fraction of a single closed job, and if it does not book qualified appointments in the first 30 days, you do not pay. Let us do a quick screen share on Thursday so you can see it live: morning or afternoon?"`,
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

