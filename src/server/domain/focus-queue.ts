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
import { wallClock, zoneForState } from "./call-time";

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
 * Formats a Date into `YYYY-MM-DDTHH:mm` in local browser/caller format for follow-up storage.
 */
export function formatFollowUpIsoLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export interface AutoCadenceResult {
  nextFollowUpIso: string | null;
  cadenceReason: string;
  isTerminal: boolean;
}

/**
 * Closed-Loop Auto-Cadence Engine:
 * Guarantees that EVERY non-terminal call outcome automatically schedules a smart next retry
 * if the caller did not manually pick a date. No lead can ever fall into a black hole.
 */
export function computeAutoFollowUpCadence(input: {
  outcome: CallOutcomeKey;
  previousAttempts: number;
  explicitFollowUpDate?: string | null;
  nowMs?: number;
}): AutoCadenceResult {
  const nowMs = input.nowMs ?? Date.now();
  const explicit = (input.explicitFollowUpDate || "").trim();

  if (explicit) {
    return {
      nextFollowUpIso: explicit,
      cadenceReason: "Manual follow-up scheduled by caller",
      isTerminal: false,
    };
  }

  // Terminal outcomes: remove from active calling retry loop
  if (input.outcome === "NOT_INTERESTED" || input.outcome === "WRONG_NUMBER") {
    return {
      nextFollowUpIso: null,
      cadenceReason: "Closed outcome — removed from retry queue",
      isTerminal: true,
    };
  }

  if (input.outcome === "MEETING_BOOKED") {
    return {
      nextFollowUpIso: null,
      cadenceReason: "Meeting booked — moved to won pipeline",
      isTerminal: true,
    };
  }

  const attemptNum = Math.max(1, input.previousAttempts + 1);

  // Max 6 attempts on unresponsive leads before resting in nurture
  if (
    attemptNum >= 6 &&
    (input.outcome === "NO_ANSWER" || input.outcome === "CALL_COMPLETED")
  ) {
    const nextWeek = new Date(nowMs + 7 * 86400_000);
    nextWeek.setHours(19, 0, 0, 0);
    return {
      nextFollowUpIso: formatFollowUpIsoLocal(nextWeek),
      cadenceReason: "Attempt 6 reached — moved to 7-day low-priority nurture",
      isTerminal: false,
    };
  }

  // Connected with Decision Maker: NEVER allow a connected lead to go without a follow-up!
  if (input.outcome === "CONNECTED") {
    const tomorrow = new Date(nowMs + 86400_000);
    tomorrow.setHours(19, 0, 0, 0); // 7:00 PM PKT (9:00 AM CT / 10:00 AM ET)
    return {
      nextFollowUpIso: formatFollowUpIsoLocal(tomorrow),
      cadenceReason: "Auto-protected owner conversation (24h follow-up lock)",
      isTerminal: false,
    };
  }

  // Gatekeeper Blocked: schedule for early morning / late afternoon bypass window next day
  if (input.outcome === "GATEKEEPER_BLOCKED") {
    const target = new Date(nowMs + (attemptNum === 1 ? 86400_000 : 2 * 86400_000));
    // Alternate between early morning (5:45 PM PKT = 8:45 AM ET) and late afternoon (1:45 AM PKT / 4:45 PM ET)
    target.setHours(attemptNum % 2 === 1 ? 18 : 22, 15, 0, 0);
    return {
      nextFollowUpIso: formatFollowUpIsoLocal(target),
      cadenceReason: "Auto-scheduled for Gatekeeper Bypass window",
      isTerminal: false,
    };
  }

  // Left Voicemail: give 48 hours for callback before next follow-up touch
  if (input.outcome === "CALL_COMPLETED") {
    const target = new Date(nowMs + 2 * 86400_000);
    target.setHours(19, 30, 0, 0);
    return {
      nextFollowUpIso: formatFollowUpIsoLocal(target),
      cadenceReason: "Voicemail cadence (+48h follow-up)",
      isTerminal: false,
    };
  }

  // No Answer:
  // Attempt 1 -> Retry in +4 hours (shift from morning to afternoon or next day prime window)
  // Attempt 2 -> Retry tomorrow (+24h)
  // Attempt 3+ -> Retry in +48h
  if (attemptNum === 1) {
    const fourHoursLater = new Date(nowMs + 4 * 3600_000);
    return {
      nextFollowUpIso: formatFollowUpIsoLocal(fourHoursLater),
      cadenceReason: "Attempt 1 No-Answer -> +4h time-shift retry",
      isTerminal: false,
    };
  }

  const daysOut = attemptNum === 2 ? 1 : 2;
  const retryDate = new Date(nowMs + daysOut * 86400_000);
  retryDate.setHours(attemptNum % 2 === 0 ? 21 : 18, 30, 0, 0);
  return {
    nextFollowUpIso: formatFollowUpIsoLocal(retryDate),
    cadenceReason: `Attempt ${attemptNum} No-Answer -> +${daysOut}d cadence retry`,
    isTerminal: false,
  };
}

export type FocusPriorityTier =
  | "MANDATORY_FOLLOW_UP_DUE"
  | "UPCOMING_FOLLOW_UP"
  | "PRIME_WINDOW_FRESH"
  | "CADENCE_RETRY_DUE"
  | "STANDARD_QUEUE";

export interface RankedFocusLead<T> {
  lead: T;
  priorityScore: number;
  tier: FocusPriorityTier;
  reasonBadge: string;
  isMandatoryFollowUpLock: boolean;
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
    const followUpMs = followUpRaw ? Date.parse(followUpRaw) : NaN;
    const hasValidFollowUp = !Number.isNaN(followUpMs);

    const icp = lead.icpScore ?? 60;
    const facts = lead.facts || {};
    const hasAdSpendSignal =
      facts["bleeding_ads"] === "YES" ||
      facts["google_ads"] === "YES" ||
      facts["zillow_advertiser"] === "YES";
    const adBonus = hasAdSpendSignal ? 18 : 0;

    // 1. Check if this is a HUMAN-SCHEDULED or CONNECTED follow-up vs an auto-retry
    const isHighPriorityFollowUp =
      hasValidFollowUp &&
      (derived.key === "CONNECTED" ||
        derived.key === "GATEKEEPER_BLOCKED" ||
        lead.status === "NURTURE" ||
        lead.status === "CONNECTED" ||
        lead.status === "PAIN_FOUND");

    // TIER 1: Mandatory Follow-Up Due Now or Overdue (Grace window: due within next 5 mins)
    if (hasValidFollowUp && followUpMs <= nowMs + 5 * 60_000) {
      const overdueMinutes = Math.max(0, Math.round((nowMs - followUpMs) / 60_000));
      // Lock the queue if it's a connected/callback follow-up or explicitly due
      const isMandatoryLock =
        isHighPriorityFollowUp || overdueMinutes >= 0;

      ranked.push({
        lead,
        priorityScore: 100_000 + Math.min(5_000, overdueMinutes) + icp + adBonus,
        tier: "MANDATORY_FOLLOW_UP_DUE",
        reasonBadge:
          overdueMinutes > 60
            ? `🔔 Follow-Up Overdue (${Math.floor(overdueMinutes / 60)}h ${overdueMinutes % 60}m)`
            : overdueMinutes > 0
            ? `🔔 Follow-Up Due (${overdueMinutes}m ago)`
            : "🔔 Follow-Up Due Right Now",
        isMandatoryFollowUpLock: isMandatoryLock,
        overdueMinutes,
        followUpIso: followUpRaw,
        derivedStatus: derived.key,
        attempts: derived.attempts,
        localTime,
      });
      continue;
    }

    // TIER 2: Follow-Up Coming Up Soon (within next 45 mins)
    if (hasValidFollowUp && followUpMs <= nowMs + 45 * 60_000) {
      const minsUntil = Math.max(1, Math.round((followUpMs - nowMs) / 60_000));
      ranked.push({
        lead,
        priorityScore: 50_000 - minsUntil * 10 + icp,
        tier: "UPCOMING_FOLLOW_UP",
        reasonBadge: `⏰ Callback in ${minsUntil}m`,
        isMandatoryFollowUpLock: false,
        overdueMinutes: 0,
        followUpIso: followUpRaw,
        derivedStatus: derived.key,
        attempts: derived.attempts,
        localTime,
      });
      continue;
    }

    // If a lead has a future follow-up > 45 mins away, hold it back until its scheduled time
    // UNLESS all untouched leads are exhausted (gives it a low score at the back of the deck)
    if (hasValidFollowUp && followUpMs > nowMs + 45 * 60_000) {
      ranked.push({
        lead,
        priorityScore: 100 + icp - Math.min(90, Math.round((followUpMs - nowMs) / 3600_000)),
        tier: "STANDARD_QUEUE",
        reasonBadge: "📅 Scheduled for Later",
        isMandatoryFollowUpLock: false,
        overdueMinutes: 0,
        followUpIso: followUpRaw,
        derivedStatus: derived.key,
        attempts: derived.attempts,
        localTime,
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
        lead,
        priorityScore: score,
        tier,
        reasonBadge: badge,
        isMandatoryFollowUpLock: false,
        overdueMinutes: 0,
        followUpIso: null,
        derivedStatus: derived.key,
        attempts: 0,
        localTime,
      });
      continue;
    }

    // TIER 4: Previously Dialed Leads Eligible for Retry
    const retryPenalty = derived.attempts * 45;
    const retryScore = 4_000 + localTime.windowScoreBoost * 15 + icp * 2 + adBonus - retryPenalty;
    ranked.push({
      lead,
      priorityScore: retryScore,
      tier: "CADENCE_RETRY_DUE",
      reasonBadge: `🔄 Retry Attempt #${derived.attempts + 1} (${derived.def.label})`,
      isMandatoryFollowUpLock: false,
      overdueMinutes: 0,
      followUpIso: null,
      derivedStatus: derived.key,
      attempts: derived.attempts,
      localTime,
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
