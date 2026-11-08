"use client";

import React, { useState, useMemo, useEffect } from "react";
import { type CallerLeadView } from "@/server/repo/caller";
import {
  CALL_STATUS_DEFS,
  deriveCallStatus,
  extractFollowUp,
  parseCallLog,
  type CallOutcomeKey,
  type LiveCrmTelemetry,
} from "@/server/domain/call-outcomes";
import {
  rankLeadsForFocusStream,
  buildFlashBattlecard,
  getQuickNoteChipsForOutcome,
  computeAutoFollowUpCadence,
  computeProspectLocalTimeInfo,
} from "@/server/domain/focus-queue";
import {
  resolveSmartFieldValue,
  type NicheSmartField,
} from "@/server/domain/niche-fields";
import {
  buildPresetFollowUpIso,
  formatFollowUpLabel,
} from "@/components/crm-lead-sheet";
import { matchLeadSearchQuery } from "@/components/crm-date-utils";
import { CallStatusBadge } from "@/components/call-status-ui";
import {
  US_TZ_GROUPS,
  parseFollowUpMs,
  wallClock,
} from "@/server/domain/call-time";
import {
  PhoneCall,
  Phone,
  Copy,
  Check,
  Sparkles,
  Calendar,
  Clock,
  Building2,
  MapPin,
  ExternalLink,
  Mail,
  Flame,
  Zap,
  Target,
  Shield,
  CheckCircle2,
  Search,
  TrendingUp,
  Lock,
  Pencil,
  X,
  MessageSquare,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Award,
  Trash2,
} from "lucide-react";

export interface FocusCockpitSubmitPayload {
  lead: CallerLeadView;
  outcome: CallOutcomeKey;
  callerNotes: string;
  followUpDate: string | null;
  clearFollowUp?: boolean;
  softwareConfirmed?: string | null;
  fleetSizeConfirmed?: number | null;
  clientLogId?: string;
}

interface CallerFocusCockpitProps {
  leads: CallerLeadView[];
  telemetry: LiveCrmTelemetry;
  nicheName: string;
  smartFields: NicheSmartField[];
  activeActorName: string;
  isOwner?: boolean;
  canEditContacts: boolean;
  getOpeningScript: (lead: CallerLeadView) => string;
  onLogCallAndAdvance: (payload: FocusCockpitSubmitPayload) => void;
  onRescheduleFollowUp?: (
    lead: CallerLeadView,
    followUpDate: string | null,
    note?: string
  ) => void;
  onSmartFieldChange?: (
    lead: CallerLeadView,
    field: NicheSmartField,
    nextVal: string
  ) => void;
  onOpenEditLead: (lead: CallerLeadView) => void;
  onSwitchToFullCrm?: (filterStatus?: string) => void;
  onResetLead?: (lead: CallerLeadView) => void;
  onDeleteCallLog?: (lead: CallerLeadView, logIndex: number) => void;
}

type ScriptTabKey =
  | "OPENING"
  | "GATEKEEPER"
  | "OBJ_BUSY"
  | "OBJ_CURRENT_SYSTEM"
  | "OBJ_SEND_EMAIL"
  | "OBJ_PRICE";

const DISPOSITION_BUTTONS: Array<{
  key: CallOutcomeKey;
  hotkey: string;
  label: string;
  sublabel: string;
  accentClass: string;
  activeClass: string;
}> = [
  {
    key: "NO_ANSWER",
    hotkey: "1",
    label: "No Answer",
    sublabel: "Log attempt • No callback forced",
    accentClass:
      "border-white/10 bg-[#09090b]/80 hover:border-slate-500 text-slate-200",
    activeClass:
      "border-slate-300 bg-slate-500/25 text-white ring-2 ring-slate-400 shadow-md",
  },
  {
    key: "CALL_COMPLETED",
    hotkey: "2",
    label: "Left Voicemail",
    sublabel: "Log voicemail • No callback forced",
    accentClass:
      "border-white/10 bg-[#09090b]/80 hover:border-violet-500 text-violet-200",
    activeClass:
      "border-violet-300 bg-violet-500/25 text-white ring-2 ring-violet-400 shadow-md",
  },
  {
    key: "GATEKEEPER_BLOCKED",
    hotkey: "3",
    label: "Receptionist / GK",
    sublabel: "Log GK • Set callback if needed",
    accentClass:
      "border-white/10 bg-[#09090b]/80 hover:border-amber-500 text-amber-200",
    activeClass:
      "border-amber-300 bg-amber-500/25 text-white ring-2 ring-amber-400 shadow-md",
  },
  {
    key: "CONNECTED",
    hotkey: "4",
    label: "Spoke to Owner",
    sublabel: "Owner spoke • Set callback if needed",
    accentClass:
      "border-white/10 bg-[#09090b]/80 hover:border-sky-500 text-sky-200",
    activeClass:
      "border-sky-300 bg-sky-500/30 text-white ring-2 ring-sky-400 shadow-md",
  },
  {
    key: "MEETING_BOOKED",
    hotkey: "5",
    label: "Meeting Booked 🎉",
    sublabel: "Demo / appointment confirmed",
    accentClass:
      "border-emerald-500/30 bg-emerald-950/20 hover:border-emerald-400 text-emerald-200",
    activeClass:
      "border-emerald-300 bg-emerald-500/30 text-white ring-2 ring-emerald-400 shadow-md",
  },
  {
    key: "NOT_INTERESTED",
    hotkey: "6",
    label: "Not Interested",
    sublabel: "Owner declined",
    accentClass:
      "border-white/10 bg-[#09090b]/80 hover:border-rose-500 text-rose-200",
    activeClass:
      "border-rose-300 bg-rose-500/25 text-white ring-2 ring-rose-400 shadow-md",
  },
  {
    key: "WRONG_NUMBER",
    hotkey: "7",
    label: "Wrong Number",
    sublabel: "Disconnected / bad number",
    accentClass:
      "border-white/10 bg-[#09090b]/80 hover:border-pink-500 text-pink-200",
    activeClass:
      "border-pink-300 bg-pink-500/25 text-white ring-2 ring-pink-400 shadow-md",
  },
];

export function CallerFocusCockpit({
  leads,
  telemetry,
  nicheName,
  smartFields,
  activeActorName,
  isOwner = false,
  canEditContacts,
  getOpeningScript,
  onLogCallAndAdvance,
  onRescheduleFollowUp,
  onSmartFieldChange,
  onOpenEditLead,
  onSwitchToFullCrm,
  onResetLead,
  onDeleteCallLog,
}: CallerFocusCockpitProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [cursorIndex, setCursorIndex] = useState<number>(0);
  const [pinnedLeadId, setPinnedLeadId] = useState<string | null>(null);
  const [sessionStreak, setSessionStreak] = useState<number>(0);
  const [sessionCompletedIds, setSessionCompletedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [snoozedLockIds, setSnoozedLockIds] = useState<Set<string>>(
    () => new Set()
  );
  const [lastLoggedInfo, setLastLoggedInfo] = useState<{
    lead: CallerLeadView;
    outcomeLabel: string;
  } | null>(null);

  // Active Disposition State
  const [selectedOutcome, setSelectedOutcome] = useState<CallOutcomeKey | null>(
    null
  );
  const [noteText, setNoteText] = useState<string>("");
  const [followUpDate, setFollowUpDate] = useState<string>("");
  const [followUpPresetUsed, setFollowUpPresetUsed] = useState<string | null>(
    null
  );
  const [autoCadenceReason, setAutoCadenceReason] = useState<string | null>(
    null
  );
  const [activeScriptTab, setActiveScriptTab] =
    useState<ScriptTabKey>("OPENING");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [validationHint, setValidationHint] = useState<string | null>(null);

  // Built-In Drawers (Lookup Drawer & US Timezone Drawer)
  const [activeDrawer, setActiveDrawer] = useState<
    "NONE" | "LOOKUP" | "ANALYTICS"
  >("NONE");
  const [lookupQuery, setLookupQuery] = useState<string>("");
  const [lookupTab, setLookupTab] = useState<
    "FOLLOW_UPS" | "ALL" | "MEETINGS"
  >("FOLLOW_UPS");

  // Update clock every 15s so due follow-ups surface in real time
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  // Intelligent queue stream scope (ALL callable leads, Fresh untouched only, Callbacks only, or Retries only)
  const [streamScope, setStreamScope] = useState<
    "ALL" | "FRESH" | "CALLBACKS" | "RETRIES"
  >("ALL");

  // Rank all leads into the intelligent Focus Stream
  const rankedStream = useMemo(
    () => rankLeadsForFocusStream(leads, nowMs),
    [leads, nowMs]
  );

  // Active callable stream excludes future callbacks (>45m away) that are held back until due
  const activeCallableStream = useMemo(
    () =>
      rankedStream.filter(
        (r) => !r.isHeldBack && !sessionCompletedIds.has(r.lead.companyId)
      ),
    [rankedStream, sessionCompletedIds]
  );

  const freshStream = useMemo(
    () =>
      rankedStream.filter(
        (r) =>
          r.derivedStatus === "UNTOUCHED" &&
          !r.isHeldBack &&
          !sessionCompletedIds.has(r.lead.companyId)
      ),
    [rankedStream, sessionCompletedIds]
  );

  const freshUncalledCount = freshStream.length;

  const retriesStream = useMemo(
    () =>
      rankedStream.filter(
        (r) =>
          r.tier === "CADENCE_RETRY_DUE" &&
          !sessionCompletedIds.has(r.lead.companyId)
      ),
    [rankedStream, sessionCompletedIds]
  );

  const retriesCount = retriesStream.length;

  const allCallbacksStream = useMemo(() => {
    return rankedStream
      .filter(
        (r) =>
          r.tier === "MANDATORY_FOLLOW_UP_DUE" ||
          r.tier === "UPCOMING_FOLLOW_UP" ||
          r.tier === "SCHEDULED_FOLLOW_UP" ||
          Boolean(r.followUpIso)
      )
      .sort((a, b) => {
        const msA = parseFollowUpMs(a.followUpIso) ?? Number.MAX_SAFE_INTEGER;
        const msB = parseFollowUpMs(b.followUpIso) ?? Number.MAX_SAFE_INTEGER;
        return msA - msB;
      });
  }, [rankedStream]);

  const callbacksTotalCount = allCallbacksStream.length;

  const mandatoryDueCount = useMemo(
    () =>
      rankedStream.filter((r) => r.tier === "MANDATORY_FOLLOW_UP_DUE").length,
    [rankedStream]
  );

  // Scoped stream according to active stream filter tab
  const scopedStream = useMemo(() => {
    if (streamScope === "FRESH") {
      return freshStream;
    }
    if (streamScope === "CALLBACKS") {
      return allCallbacksStream;
    }
    if (streamScope === "RETRIES") {
      return retriesStream;
    }
    return activeCallableStream;
  }, [
    activeCallableStream,
    freshStream,
    allCallbacksStream,
    retriesStream,
    streamScope,
  ]);

  // Stream of leads for the active tab (matches tab badge count 100%)
  const uncontactedStream = useMemo(
    () =>
      streamScope === "CALLBACKS"
        ? scopedStream
        : scopedStream.filter((r) => !sessionCompletedIds.has(r.lead.companyId)),
    [scopedStream, sessionCompletedIds, streamScope]
  );

  // Resolve current active item in stream
  const activeRankedItem = useMemo(() => {
    if (pinnedLeadId) {
      const found =
        scopedStream.find((r) => r.lead.companyId === pinnedLeadId) ||
        rankedStream.find((r) => r.lead.companyId === pinnedLeadId);
      if (found) return found;
      const directLead = leads.find((l) => l.companyId === pinnedLeadId);
      if (directLead) {
        const derived = deriveCallStatus(directLead);
        const fuIso =
          directLead.nextFollowUp || extractFollowUp(directLead.notes);
        return {
          lead: directLead,
          priorityScore: 999_999,
          tier: "MANDATORY_FOLLOW_UP_DUE" as const,
          reasonBadge: "📌 Selected Lead",
          isMandatoryFollowUpLock: false,
          isHeldBack: false,
          overdueMinutes: 0,
          followUpIso: fuIso,
          derivedStatus: derived.key,
          attempts: derived.attempts,
          localTime: computeProspectLocalTimeInfo(directLead.state, nowMs),
        };
      }
    }
    if (uncontactedStream.length === 0) return null;
    if (
      uncontactedStream[0]?.isMandatoryFollowUpLock &&
      !snoozedLockIds.has(uncontactedStream[0].lead.companyId)
    ) {
      return uncontactedStream[0];
    }
    const safeIdx = Math.min(
      Math.max(0, cursorIndex),
      uncontactedStream.length - 1
    );
    return uncontactedStream[safeIdx] || uncontactedStream[0]!;
  }, [
    leads,
    scopedStream,
    rankedStream,
    uncontactedStream,
    cursorIndex,
    pinnedLeadId,
    snoozedLockIds,
    nowMs,
  ]);

  const activeLead = activeRankedItem?.lead ?? null;
  const activeLeadId = activeLead?.companyId ?? null;

  // Reset local disposition inputs ONLY when the lead changes
  useEffect(() => {
    setSelectedOutcome(null);
    setNoteText("");
    setFollowUpDate(activeLead?.nextFollowUp || "");
    setFollowUpPresetUsed(activeLead?.nextFollowUp ? "EXISTING" : null);
    setAutoCadenceReason(null);
    setActiveScriptTab("OPENING");
    setValidationHint(null);
  }, [activeLeadId, activeLead?.nextFollowUp]);

  // Clean raw phone number (removes brackets, dashes, spaces)
  const rawDialPhone = activeLead?.bestContact.phone || activeLead?.phone || "";
  const cleanDialPhone = rawDialPhone.replace(/\D/g, "");

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // Navigate to previous or next lead in uncontactedStream without logging a fake call
  const handlePrevLead = () => {
    if (pinnedLeadId) {
      setPinnedLeadId(null);
      return;
    }
    if (uncontactedStream.length <= 1) return;
    setCursorIndex((prev) =>
      prev > 0 ? prev - 1 : uncontactedStream.length - 1
    );
  };

  const handleNextOrSkipLead = () => {
    if (!activeLead) return;
    if (pinnedLeadId) {
      setPinnedLeadId(null);
      return;
    }
    if (activeRankedItem?.isMandatoryFollowUpLock) {
      setSnoozedLockIds((prev) => {
        const next = new Set(prev);
        next.add(activeLead.companyId);
        return next;
      });
    }
    if (uncontactedStream.length <= 1) return;
    setCursorIndex((prev) => (prev + 1) % uncontactedStream.length);
  };

  // Reschedule a follow-up directly (without logging a fake call) and advance
  const handleDirectReschedule = (
    targetLead: CallerLeadView,
    nextFollowUpIso: string | null,
    note?: string,
    advanceAfter = true
  ) => {
    if (onRescheduleFollowUp) {
      onRescheduleFollowUp(targetLead, nextFollowUpIso, note);
    }
    if (advanceAfter && activeLead?.companyId === targetLead.companyId) {
      setSessionCompletedIds((prev) => {
        const next = new Set(prev);
        next.add(targetLead.companyId);
        return next;
      });
      setPinnedLeadId(null);
      setCursorIndex(0);
    }
  };

  // Commit outcome & advance to next lead in stream
  const commitDisposition = (
    outcomeToCommit: CallOutcomeKey,
    overrideNotes?: string,
    overrideFollowUp?: string | null
  ) => {
    if (!activeLead) return;

    const dialedId = activeLead.companyId;
    const finalNotes = (
      overrideNotes !== undefined ? overrideNotes : noteText
    ).trim();
    const rawExplicitFollowUp =
      overrideFollowUp !== undefined
        ? overrideFollowUp
        : followUpDate.trim() || null;

    const isTerminal =
      outcomeToCommit === "MEETING_BOOKED" ||
      outcomeToCommit === "NOT_INTERESTED" ||
      outcomeToCommit === "WRONG_NUMBER";

    const finalFollowUp =
      !isTerminal && rawExplicitFollowUp && rawExplicitFollowUp.trim().length > 0
        ? rawExplicitFollowUp.trim()
        : null;

    const clientLogId = `cockpit_${dialedId}_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    setSessionStreak((s) => s + 1);
    setSessionCompletedIds((prev) => {
      const next = new Set(prev);
      next.add(dialedId);
      return next;
    });
    setLastLoggedInfo({
      lead: activeLead,
      outcomeLabel: CALL_STATUS_DEFS[outcomeToCommit]?.label || outcomeToCommit,
    });
    setPinnedLeadId(null);
    setCursorIndex(0);

    onLogCallAndAdvance({
      lead: activeLead,
      outcome: outcomeToCommit,
      callerNotes: finalNotes,
      followUpDate: finalFollowUp,
      clearFollowUp: followUpPresetUsed === "CLEARED" || isTerminal,
      clientLogId,
    });
  };

  // Handle clicking one of the 7 Disposition Buttons:
  // - Never forces unwanted calendar follow-ups on normal cold calls (No Answer, Voicemail, GK, Connected).
  // - Callers only set a callback date when a lead genuinely needs a follow-up (via 1-click presets or custom date).
  // - However, if the lead ALREADY had a scheduled callback and the caller could not reach the owner
  //   (No Answer / Voicemail / Receptionist), pre-fills the next US business window so a real callback is never lost.
  const handleSelectDisposition = (btn: (typeof DISPOSITION_BUTTONS)[number]) => {
    setValidationHint(null);
    setSelectedOutcome(btn.key);

    if (!activeLead || !activeRankedItem) return;

    const isTerminal =
      btn.key === "MEETING_BOOKED" ||
      btn.key === "NOT_INTERESTED" ||
      btn.key === "WRONG_NUMBER";

    if (isTerminal) {
      setFollowUpDate("");
      setFollowUpPresetUsed(null);
      setAutoCadenceReason(null);
      return;
    }

    const existingFu =
      activeLead.nextFollowUp || extractFollowUp(activeLead.notes);
    const isUnfulfilledAttempt =
      btn.key === "NO_ANSWER" ||
      btn.key === "CALL_COMPLETED" ||
      btn.key === "GATEKEEPER_BLOCKED";

    // Only auto-shift if this lead ALREADY had a scheduled callback and the caller couldn't reach the owner
    if (
      existingFu &&
      isUnfulfilledAttempt &&
      (!followUpPresetUsed ||
        followUpPresetUsed === "AUTO" ||
        followUpPresetUsed === "EXISTING")
    ) {
      const cadence = computeAutoFollowUpCadence({
        outcome: btn.key,
        previousAttempts: activeRankedItem.attempts,
        state: activeLead.state,
        nowMs,
      });
      if (cadence.nextFollowUpIso) {
        setFollowUpDate(cadence.nextFollowUpIso);
        setFollowUpPresetUsed("AUTO");
        setAutoCadenceReason("Existing callback shifted to next US window");
        return;
      }
    }

    // For normal cold calls (or when Connected is selected without a new preset chosen yet),
    // do not force a follow-up date unless the caller explicitly clicked a preset or custom date.
    if (
      !followUpPresetUsed ||
      followUpPresetUsed === "AUTO" ||
      followUpPresetUsed === "EXISTING"
    ) {
      setFollowUpDate("");
      setFollowUpPresetUsed(null);
      setAutoCadenceReason(null);
    }
  };

  // Keyboard shortcuts:
  // Space: Copy clean raw phone number
  // 1–7: Select outcome button
  // Enter: Confirm selected outcome and advance to next lead
  // [ / ]: Previous / Next lead
  // / or f: Open Callbacks & Search drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!activeLead) return;

      if (e.key === "/" || e.key === "f") {
        e.preventDefault();
        setActiveDrawer("LOOKUP");
        return;
      }

      if (e.key === "[") {
        e.preventDefault();
        handlePrevLead();
        return;
      }

      if (e.key === "]") {
        e.preventDefault();
        handleNextOrSkipLead();
        return;
      }

      if (e.code === "Space") {
        if (cleanDialPhone) {
          e.preventDefault();
          copyText(cleanDialPhone, `phone_${activeLead.companyId}`);
        }
        return;
      }

      if (e.code === "Enter") {
        if (selectedOutcome) {
          e.preventDefault();
          commitDisposition(selectedOutcome);
        }
        return;
      }

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 7) {
        const btn = DISPOSITION_BUTTONS[num - 1];
        if (btn) {
          e.preventDefault();
          handleSelectDisposition(btn);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Dynamic count of scheduled callbacks from current lead pool
  const dynamicFollowUpsCount = useMemo(() => {
    return leads.filter((l) => {
      if (l.status === "REJECTED") return false;
      return Boolean(l.nextFollowUp || extractFollowUp(l.notes));
    }).length;
  }, [leads]);

  // Lookup drawer filtered leads
  const lookupLeads = useMemo(() => {
    const q = lookupQuery.trim();
    const isSearching = q.length > 0;
    return leads
      .filter((l) => {
        if (l.status === "REJECTED") return false;
        if (!isSearching) {
          if (lookupTab === "FOLLOW_UPS") {
            const fu = l.nextFollowUp || extractFollowUp(l.notes);
            if (!fu) return false;
          } else if (lookupTab === "MEETINGS") {
            if (
              l.status !== "MEETING_BOOKED" &&
              deriveCallStatus(l).key !== "MEETING_BOOKED"
            )
              return false;
          }
        }
        if (!isSearching) return true;
        return matchLeadSearchQuery(l, q);
      })
      .sort((a, b) => {
        if (isSearching) {
          const lq = q.toLowerCase();
          const aExact =
            a.name.toLowerCase() === lq ||
            (a.bestContact?.name &&
              a.bestContact.name.toLowerCase() === lq);
          const bExact =
            b.name.toLowerCase() === lq ||
            (b.bestContact?.name &&
              b.bestContact.name.toLowerCase() === lq);
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;
          const aStarts = a.name.toLowerCase().startsWith(lq);
          const bStarts = b.name.toLowerCase().startsWith(lq);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          return (b.icpScore || 0) - (a.icpScore || 0);
        }
        if (lookupTab === "FOLLOW_UPS") {
          const fuA = a.nextFollowUp || extractFollowUp(a.notes) || "";
          const fuB = b.nextFollowUp || extractFollowUp(b.notes) || "";
          const tA = parseFollowUpMs(fuA) ?? Number.MAX_SAFE_INTEGER;
          const tB = parseFollowUpMs(fuB) ?? Number.MAX_SAFE_INTEGER;
          return tA - tB;
        }
        return 0;
      })
      .slice(0, 60);
  }, [leads, lookupQuery, lookupTab]);

  // Empty State when all leads in stream are completed
  if (!activeLead || !activeRankedItem) {
    const hasCompletedSome = sessionCompletedIds.size > 0;
    return (
      <div className="rounded-2xl border border-white/10 bg-[#121215]/85 backdrop-blur-xl p-8 text-center space-y-4 shadow-xl max-w-xl mx-auto my-6">
        <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-extrabold text-white">
            {hasCompletedSome
              ? "Calling Round Complete 🎉"
              : streamScope === "CALLBACKS"
              ? "No Scheduled Callbacks Yet"
              : "Active Calling Stream is Clear!"}
          </h2>
          <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
            {hasCompletedSome
              ? `Great rhythm! You have completed ${sessionCompletedIds.size} leads in this calling round.`
              : streamScope === "CALLBACKS"
              ? "When you log a call with a callback date (or select No Answer / Voicemail / Receptionist), scheduled callbacks appear right here."
              : "All assigned leads in this view have been called or scheduled for future callbacks."}
          </p>
        </div>

        {hasCompletedSome && (
          <div className="inline-flex items-center gap-2 rounded-full bg-black/50 border border-white/10 px-4 py-1.5 text-xs text-zinc-300">
            <span>
              Session Dials:{" "}
              <strong className="text-emerald-400 font-mono">
                {sessionStreak}
              </strong>
            </span>
            <span>•</span>
            <span>
              Answered:{" "}
              <strong className="text-sky-300 font-mono">
                {telemetry.answeredLeads}
              </strong>
            </span>
            <span>•</span>
            <span>
              Meetings:{" "}
              <strong className="text-emerald-400 font-mono">
                {telemetry.meetingsBooked}
              </strong>
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          {lastLoggedInfo && onResetLead && (
            <button
              type="button"
              onClick={() => {
                onResetLead(lastLoggedInfo.lead);
                setSessionCompletedIds((prev) => {
                  const next = new Set(prev);
                  next.delete(lastLoggedInfo.lead.companyId);
                  return next;
                });
                setPinnedLeadId(lastLoggedInfo.lead.companyId);
                setLastLoggedInfo(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 font-bold px-4 py-2 text-xs transition shadow-sm cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>
                Undo Last: {lastLoggedInfo.lead.name} ({lastLoggedInfo.outcomeLabel})
              </span>
            </button>
          )}

          {streamScope !== "ALL" && (
            <button
              type="button"
              onClick={() => {
                setStreamScope("ALL");
                setCursorIndex(0);
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold px-4 py-2 text-xs transition shadow-sm cursor-pointer"
            >
              <span>Back to All Callable Leads ({activeCallableStream.length})</span>
            </button>
          )}

          {hasCompletedSome && (
            <button
              type="button"
              onClick={() => {
                setSessionCompletedIds(new Set());
                setSnoozedLockIds(new Set());
                setCursorIndex(0);
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold px-4 py-2 text-xs transition shadow-sm cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Start Next Dialing Round</span>
            </button>
          )}

          {!hasCompletedSome && leads.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSessionCompletedIds(new Set());
                setSnoozedLockIds(new Set());
                setStreamScope("ALL");
                setCursorIndex(0);
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold px-4 py-2 text-xs transition border border-white/10 shadow-sm cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Review Assigned Queue ({leads.length})</span>
            </button>
          )}

          {callbacksTotalCount > 0 && streamScope !== "CALLBACKS" && (
            <button
              type="button"
              onClick={() => {
                setStreamScope("CALLBACKS");
                setSessionCompletedIds(new Set());
                setCursorIndex(0);
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-bold px-4 py-2 text-xs transition border border-amber-500/30 shadow-sm cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Open Callbacks ({callbacksTotalCount})</span>
            </button>
          )}

          {isOwner && onSwitchToFullCrm && (
            <button
              type="button"
              onClick={() => onSwitchToFullCrm("ALL")}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold px-4 py-2 text-xs transition border border-white/10 shadow-sm cursor-pointer"
            >
              <span>View Full Lead Table ({leads.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  const dmName = activeLead.bestContact.name;
  const dmTitle = activeLead.bestContact.title;
  const dmEmail = activeLead.bestContact.email;
  const callHistory = parseCallLog(activeLead.notes);
  const openingScript = getOpeningScript(activeLead);
  const activeFollowUpRaw =
    activeLead.nextFollowUp || extractFollowUp(activeLead.notes);
  const activeFollowUpInfo = formatFollowUpLabel(
    activeFollowUpRaw,
    activeLead.state
  );

  const battlecard = buildFlashBattlecard({
    companyName: activeLead.name,
    contactName: dmName,
    contactTitle: dmTitle,
    city: activeLead.city,
    state: activeLead.state,
    nicheName: activeLead.marketName || nicheName,
    software: activeLead.software,
    financing: activeLead.financing,
    replacement: activeLead.replacement,
    facts: activeLead.facts,
    researchSummary: activeLead.researchSummary,
    openingScript,
  });

  const quickChips = selectedOutcome
    ? getQuickNoteChipsForOutcome(selectedOutcome)
    : [];

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${activeLead.name} ${activeLead.address || ""} ${activeLead.city || ""} ${
      activeLead.state || ""
    }`
  )}`;

  const totalInScope = uncontactedStream.length;
  const safePosition =
    uncontactedStream.findIndex(
      (r) => r.lead.companyId === activeLead.companyId
    ) + 1 || 1;

  return (
    <div className="space-y-2.5">
      {/* =================================================================== */}
      {/* 1. COMPACT CALLER HUD BAR: NAVIGATION, STREAM TABS & LIVE STATS     */}
      {/* =================================================================== */}
      <div className="rounded-xl border border-white/10 bg-[#121215]/90 backdrop-blur-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* Lead Counter + Prev / Next Navigation */}
          <div className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-950/25 p-0.5 pl-2.5 text-xs font-bold text-emerald-300 shadow-sm">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="pr-1">
              {pinnedLeadId
                ? "Selected Lead"
                : `Lead ${safePosition} of ${Math.max(1, totalInScope)}`}
            </span>
            <button
              type="button"
              onClick={handlePrevLead}
              disabled={!pinnedLeadId && uncontactedStream.length <= 1}
              title="Previous lead in queue (Shortcut: [)"
              className="p-1 rounded-full hover:bg-emerald-500/20 text-emerald-200 disabled:opacity-30 transition cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleNextOrSkipLead}
              disabled={!pinnedLeadId && uncontactedStream.length <= 1}
              title="Skip / Next lead in queue (Shortcut: ])"
              className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 text-[10px] font-bold text-emerald-200 disabled:opacity-30 transition cursor-pointer"
            >
              <span>Next</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {/* Stream Scope Selector: All Callable | Fresh | Callbacks (Always Visible) */}
          <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded-full p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => {
                setStreamScope("ALL");
                setPinnedLeadId(null);
                setCursorIndex(0);
              }}
              title="Active calling stream (Due callbacks + Fresh leads + Retries)"
              className={`px-2.5 py-0.5 rounded-full font-semibold transition cursor-pointer ${
                streamScope === "ALL"
                  ? "bg-zinc-800 text-white font-bold shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Stream ({activeCallableStream.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setStreamScope("FRESH");
                setPinnedLeadId(null);
                setCursorIndex(0);
              }}
              title="Only untouched leads that have never been dialed"
              className={`px-2.5 py-0.5 rounded-full font-semibold transition cursor-pointer ${
                streamScope === "FRESH"
                  ? "bg-emerald-500 text-black font-extrabold shadow-sm"
                  : "text-emerald-400/90 hover:text-emerald-300"
              }`}
            >
              Fresh ({freshUncalledCount})
            </button>
            <button
              type="button"
              onClick={() => {
                setStreamScope("CALLBACKS");
                setPinnedLeadId(null);
                setCursorIndex(0);
              }}
              title="Only intentional scheduled callbacks (Overdue, Due Today, and Upcoming)"
              className={`px-2.5 py-0.5 rounded-full font-semibold transition cursor-pointer inline-flex items-center gap-1 ${
                streamScope === "CALLBACKS"
                  ? "bg-amber-400 text-black font-extrabold shadow-sm"
                  : mandatoryDueCount > 0
                  ? "text-rose-300 hover:text-rose-200 font-bold"
                  : "text-amber-300/90 hover:text-amber-200"
              }`}
            >
              <span>Callbacks ({callbacksTotalCount})</span>
              {mandatoryDueCount > 0 && (
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-rose-400 animate-ping" />
              )}
            </button>
            {retriesCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setStreamScope("RETRIES");
                  setPinnedLeadId(null);
                  setCursorIndex(0);
                }}
                title="Previously dialed leads (No Answer / Voicemail / GK) eligible for retry"
                className={`px-2.5 py-0.5 rounded-full font-semibold transition cursor-pointer ${
                  streamScope === "RETRIES"
                    ? "bg-sky-400 text-black font-extrabold shadow-sm"
                    : "text-sky-300/90 hover:text-sky-200"
                }`}
              >
                Retries ({retriesCount})
              </button>
            )}
          </div>

          {sessionStreak > 0 && (
            <div className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
              <Flame className="w-3 h-3 text-amber-400" />
              <span>{sessionStreak} Dials</span>
            </div>
          )}

          {sessionCompletedIds.size > 0 && (
            <button
              type="button"
              onClick={() => {
                setSessionCompletedIds(new Set());
                setSnoozedLockIds(new Set());
                setCursorIndex(0);
              }}
              className="text-[10px] text-zinc-400 hover:text-white underline underline-offset-2 font-medium cursor-pointer"
              title="Reset session history to include leads already dialed in this session"
            >
              Reset Round ({sessionCompletedIds.size})
            </button>
          )}

          {lastLoggedInfo && onResetLead && (
            <button
              type="button"
              onClick={() => {
                onResetLead(lastLoggedInfo.lead);
                setSessionCompletedIds((prev) => {
                  const next = new Set(prev);
                  next.delete(lastLoggedInfo.lead.companyId);
                  return next;
                });
                setPinnedLeadId(lastLoggedInfo.lead.companyId);
                setLastLoggedInfo(null);
              }}
              className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 px-2.5 py-0.5 text-[10px] font-bold text-rose-200 transition cursor-pointer"
              title="Undo the last logged call outcome and reset that lead back to Ready to Call"
            >
              <RotateCcw className="w-3 h-3 text-rose-300" />
              <span className="truncate max-w-[190px]">
                Undo: {lastLoggedInfo.lead.name} ({lastLoggedInfo.outcomeLabel})
              </span>
            </button>
          )}
        </div>

        {/* Right HUD: Compact Live Stats + Callbacks & Search Drawer + US Timezones */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="hidden xl:flex items-center gap-1 text-[11px] mr-1">
            <span className="rounded-full bg-black/40 border border-white/10 px-2.5 py-0.5 text-zinc-300">
              Dials:{" "}
              <strong className="text-sky-300 font-mono">
                {telemetry.totalCallsDialed}
              </strong>
            </span>
            <span className="rounded-full bg-black/40 border border-white/10 px-2.5 py-0.5 text-zinc-300">
              Answered:{" "}
              <strong className="text-cyan-300 font-mono">
                {telemetry.answeredLeads}
              </strong>
            </span>
            <span className="rounded-full bg-black/40 border border-white/10 px-2.5 py-0.5 text-zinc-300">
              Spoke:{" "}
              <strong className="text-indigo-300 font-mono">
                {telemetry.connectedLeads}
              </strong>
            </span>
            <span className="rounded-full bg-black/40 border border-emerald-500/30 px-2.5 py-0.5 text-zinc-200">
              Meetings:{" "}
              <strong className="text-emerald-400 font-mono">
                {telemetry.meetingsBooked}
              </strong>
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              setActiveDrawer(activeDrawer === "LOOKUP" ? "NONE" : "LOOKUP")
            }
            title="Search any lead or manage scheduled callbacks (Shortcut: /)"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
              activeDrawer === "LOOKUP"
                ? "border-amber-400 bg-amber-500/20 text-amber-200"
                : mandatoryDueCount > 0
                ? "border-rose-500/50 bg-rose-500/20 text-rose-200"
                : "border-white/10 bg-black/40 text-zinc-300 hover:text-white hover:border-zinc-700"
            }`}
          >
            <Search className="w-3 h-3 text-amber-400" />
            <span>Search &amp; Callbacks</span>
            {Math.max(dynamicFollowUpsCount, callbacksTotalCount) > 0 && (
              <span className="rounded-full bg-amber-500/30 border border-amber-400/40 px-1.5 text-[9px] font-bold text-amber-200">
                {Math.max(dynamicFollowUpsCount, callbacksTotalCount)}
              </span>
            )}
            <kbd className="hidden sm:inline-block rounded bg-white/10 border border-white/15 px-1 text-[9px] font-mono text-zinc-400">
              /
            </kbd>
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveDrawer(
                activeDrawer === "ANALYTICS" ? "NONE" : "ANALYTICS"
              )
            }
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
              activeDrawer === "ANALYTICS"
                ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                : "border-white/10 bg-black/40 text-zinc-300 hover:text-white hover:border-zinc-700"
            }`}
          >
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <span>US Clocks</span>
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* 1.5 INLINE DRAWERS (SEARCH & CALLBACKS / US TIMEZONE CLOCKS)        */}
      {/* =================================================================== */}
      {activeDrawer === "LOOKUP" && (
        <div className="rounded-xl border border-amber-500/30 bg-[#121215]/95 backdrop-blur-xl p-3 space-y-2.5 shadow-2xl animate-in fade-in duration-150">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold text-white">
                Callbacks &amp; Lead Finder
              </span>
              <div className="flex items-center gap-1 ml-1">
                {[
                  {
                    id: "FOLLOW_UPS" as const,
                    label: `Scheduled Callbacks (${Math.max(
                      dynamicFollowUpsCount,
                      callbacksTotalCount
                    )})`,
                  },
                  {
                    id: "MEETINGS" as const,
                    label: `Meetings (${telemetry.meetingsBooked})`,
                  },
                  {
                    id: "ALL" as const,
                    label: `All Leads (${leads.length})`,
                  },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setLookupTab(t.id)}
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition cursor-pointer ${
                      lookupTab === t.id
                        ? "bg-white text-black font-bold"
                        : "bg-zinc-900 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-52 sm:w-64">
                <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  autoFocus
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  placeholder="Search company, owner, phone, notes..."
                  className="w-full rounded-full border border-white/10 bg-black/50 pl-7 pr-7 py-1 text-[11px] text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition"
                />
                {lookupQuery && (
                  <button
                    type="button"
                    onClick={() => setLookupQuery("")}
                    className="absolute right-2 top-1.5 p-0.5 rounded-full text-zinc-400 hover:text-white transition cursor-pointer"
                    title="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setActiveDrawer("NONE")}
                className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {lookupLeads.length === 0 ? (
            <div className="py-5 text-center text-xs text-zinc-400 space-y-1">
              <p className="font-semibold text-zinc-300">
                {lookupQuery
                  ? `No leads matching "${lookupQuery}"`
                  : lookupTab === "FOLLOW_UPS"
                  ? "No callbacks currently scheduled."
                  : "No matching leads found."}
              </p>
              <p className="text-[11px] text-zinc-500">
                {lookupQuery
                  ? "Try searching by company name, owner name, phone digits, or city."
                  : "Select any disposition (1–4) or pick a callback date when logging a call to schedule follow-ups."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
              {lookupLeads.map((item) => {
                const targetFu =
                  item.nextFollowUp || extractFollowUp(item.notes);
                const fu = formatFollowUpLabel(targetFu, item.state);
                const fuMs = parseFollowUpMs(targetFu);
                const isDueSoon =
                  fuMs !== null &&
                  fuMs >= nowMs &&
                  fuMs - nowMs <= 4 * 3600_000;
                const isCurrent = activeLead
                  ? item.companyId === activeLead.companyId
                  : false;
                const itemDerived = deriveCallStatus(item);
                const leadCleanPhone = (
                  item.bestContact.phone ||
                  item.phone ||
                  ""
                ).replace(/\D/g, "");
                return (
                  <div
                    key={item.companyId}
                    className={`p-2.5 rounded-xl border text-left transition flex items-start justify-between gap-2 ${
                      isCurrent
                        ? "border-emerald-400 bg-emerald-500/15"
                        : fu.isOverdue
                        ? "border-rose-500/35 bg-rose-950/15 hover:border-rose-400/60"
                        : "border-white/10 bg-black/40 hover:border-amber-400/50 hover:bg-zinc-900/80"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setPinnedLeadId(item.companyId);
                        setActiveDrawer("NONE");
                      }}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-white truncate">
                          {item.name}
                        </span>
                        {item.state && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/5 text-zinc-400 font-semibold shrink-0">
                            {item.state}
                          </span>
                        )}
                        <CallStatusBadge lead={item} />
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate mt-0.5">
                        {item.bestContact.name || "Owner"} &bull;{" "}
                        <span className="font-mono text-emerald-400">
                          {leadCleanPhone || "No phone"}
                        </span>
                      </div>
                      {fu.text && (
                        <div
                          className={`text-[10px] font-semibold mt-1 flex items-center gap-1 ${
                            fu.isOverdue
                              ? "text-rose-300 font-bold"
                              : isDueSoon
                              ? "text-amber-300 font-bold"
                              : "text-sky-300"
                          }`}
                        >
                          <span>
                            {fu.isOverdue
                              ? "🔴 Overdue:"
                              : isDueSoon
                              ? "🟡 Due Today:"
                              : "🟢 Scheduled:"}
                          </span>
                          <span className="truncate">{fu.text}</span>
                        </div>
                      )}
                    </button>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setPinnedLeadId(item.companyId);
                          setActiveDrawer("NONE");
                        }}
                        className="text-[10px] font-bold text-emerald-300 px-2 py-0.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 cursor-pointer"
                      >
                        Load →
                      </button>
                      {(itemDerived.key !== "UNTOUCHED" || Boolean(targetFu)) &&
                        onResetLead && (
                          <button
                            type="button"
                            onClick={() => {
                              onResetLead(item);
                              setSessionCompletedIds((prev) => {
                                const next = new Set(prev);
                                next.delete(item.companyId);
                                return next;
                              });
                              setPinnedLeadId(item.companyId);
                              setActiveDrawer("NONE");
                            }}
                            className="text-[9px] font-bold text-rose-300 hover:text-rose-200 underline cursor-pointer"
                            title="Reset lead outcome and clear callbacks back to Ready to Call"
                          >
                            ↺ Reset to Fresh
                          </button>
                        )}
                      {targetFu && onRescheduleFollowUp && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleDirectReschedule(
                                item,
                                buildPresetFollowUpIso("TOMORROW", item.state),
                                "Rescheduled callback to tomorrow",
                                false
                              )
                            }
                            className="text-[9px] font-semibold text-amber-300 hover:text-amber-200 underline cursor-pointer"
                            title="Move callback to tomorrow 10 AM US time"
                          >
                            Tomorrow
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleDirectReschedule(
                                item,
                                null,
                                "Cleared callback",
                                false
                              )
                            }
                            className="text-[9px] font-semibold text-zinc-400 hover:text-white underline cursor-pointer"
                            title="Remove scheduled callback"
                          >
                            Clear
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeDrawer === "ANALYTICS" && (
        <div className="rounded-xl border border-emerald-500/30 bg-[#121215]/95 backdrop-blur-xl p-3 space-y-3 shadow-2xl animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-bold text-white">
                US Business Hours &amp; Local Timezones
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveDrawer("NONE")}
              className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {US_TZ_GROUPS.slice(0, 4).map((tz) => {
              const { hour, minute } = wallClock(nowMs, tz.iana);
              const ampm = hour >= 12 ? "PM" : "AM";
              const h12 = hour % 12 === 0 ? 12 : hour % 12;
              const dec = hour + minute / 60;
              const isPrime =
                (dec >= 8.75 && dec < 11.5) || (dec >= 13.5 && dec <= 16.5);
              const isBypass =
                (dec >= 7.75 && dec < 8.75) || (dec > 16.5 && dec <= 17.75);
              return (
                <div
                  key={tz.id}
                  className={`rounded-xl border px-3 py-2 text-[11px] flex items-center justify-between ${
                    isPrime
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : isBypass
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                      : "border-white/10 bg-black/40 text-zinc-400"
                  }`}
                >
                  <div>
                    <div className="font-bold text-xs">{tz.label}</div>
                    <div className="text-[10px] opacity-85">
                      {isPrime
                        ? "🟢 Best Time to Call"
                        : isBypass
                        ? "⚡ Early/Late Owner Window"
                        : "Standard Hours"}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-xs">
                    {h12}:{String(minute).padStart(2, "0")} {ampm}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 2. DUE CALLBACK BANNER (CLEAN RESCHEDULE WITHOUT FAKE CALL LOGS)    */}
      {/* =================================================================== */}
      {(activeRankedItem.isMandatoryFollowUpLock ||
        activeRankedItem.tier === "MANDATORY_FOLLOW_UP_DUE") && (
        <div className="rounded-xl border border-amber-500/60 bg-gradient-to-r from-amber-950/50 via-black/60 to-[#121215] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 shadow-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-300 shrink-0">
              <Clock className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
                  Scheduled Callback Due
                </span>
                <span className="rounded-full bg-rose-500/20 border border-rose-500/40 px-2 py-0.2 text-[10px] font-bold text-rose-200">
                  {activeFollowUpInfo.text || activeRankedItem.reasonBadge}
                </span>
              </div>
              <p className="text-xs text-zinc-200 mt-0.5 truncate">
                Callback for <strong>{activeLead.name}</strong> (
                {dmName || "Owner"}){" "}
                {callHistory[0]?.text ? `• Last note: "${callHistory[0].text}"` : ""}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-zinc-400 mr-1 hidden sm:inline">
              Quick Snooze:
            </span>
            <button
              type="button"
              onClick={() =>
                handleDirectReschedule(
                  activeLead,
                  buildPresetFollowUpIso("LATER_TODAY", activeLead.state),
                  "Snoozed callback +3 hours"
                )
              }
              className="rounded-full bg-black/60 hover:bg-zinc-800 border border-amber-500/40 px-2.5 py-1 text-[10px] font-semibold text-amber-200 transition cursor-pointer"
              title="Move callback +3 hours later (without logging a fake call)"
            >
              +3 Hours
            </button>
            <button
              type="button"
              onClick={() =>
                handleDirectReschedule(
                  activeLead,
                  buildPresetFollowUpIso("TOMORROW", activeLead.state),
                  "Rescheduled callback to tomorrow"
                )
              }
              className="rounded-full bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 px-2.5 py-1 text-[10px] font-bold text-amber-200 transition cursor-pointer"
              title="Reschedule callback to tomorrow 10 AM US time (without logging a fake call)"
            >
              Tomorrow 10 AM
            </button>
            <button
              type="button"
              onClick={() =>
                handleDirectReschedule(
                  activeLead,
                  null,
                  "Cleared callback",
                  false
                )
              }
              className="rounded-full bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 px-2.5 py-1 text-[10px] font-semibold text-rose-200 transition cursor-pointer"
              title="Remove this callback date without logging a call"
            >
              Clear Callback
            </button>
            <button
              type="button"
              onClick={handleNextOrSkipLead}
              className="rounded-full bg-zinc-900 hover:bg-zinc-800 border border-white/10 px-2.5 py-1 text-[10px] font-semibold text-zinc-300 hover:text-white transition cursor-pointer"
              title="Temporarily skip this callback to dial the next lead"
            >
              Skip for Now →
            </button>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 3. MAIN SPLIT FOCUS COCKPIT (LEFT: INTEL & SCRIPT | RIGHT: OUTCOME) */}
      {/* =================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {/* ----------------------------------------------------------------- */}
        {/* LEFT COLUMN (7 cols): LEAD DETAILS, DIALER, QUALIFICATION, SCRIPT */}
        {/* ----------------------------------------------------------------- */}
        <div className="lg:col-span-7 rounded-2xl border border-white/10 bg-[#121215]/90 backdrop-blur-xl p-3.5 space-y-3 shadow-lg">
          {/* Top Status & Prospect Local Time Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                  activeRankedItem.tier === "MANDATORY_FOLLOW_UP_DUE"
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                    : activeRankedItem.tier === "PRIME_WINDOW_FRESH"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "border-white/10 bg-white/5 text-zinc-200"
                }`}
              >
                <span>{activeRankedItem.reasonBadge}</span>
              </span>

              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${
                  activeRankedItem.localTime.windowStatus === "PRIME_WINDOW"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : activeRankedItem.localTime.windowStatus ===
                      "GATEKEEPER_BYPASS"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    : "border-white/10 bg-black/40 text-zinc-400"
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>{activeRankedItem.localTime.windowLabel}</span>
              </span>

              {activeFollowUpRaw && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                    activeFollowUpInfo.isOverdue
                      ? "border-rose-500/40 bg-rose-500/15 text-rose-200"
                      : "border-amber-500/40 bg-amber-500/15 text-amber-200"
                  }`}
                >
                  <Calendar className="w-3 h-3" />
                  <span>Callback: {activeFollowUpInfo.text}</span>
                  {onRescheduleFollowUp && (
                    <button
                      type="button"
                      onClick={() =>
                        handleDirectReschedule(
                          activeLead,
                          null,
                          "Cleared callback",
                          false
                        )
                      }
                      className="ml-0.5 rounded-full hover:bg-black/30 p-0.5 text-current opacity-80 hover:opacity-100 cursor-pointer"
                      title="Clear scheduled callback"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {pinnedLeadId && (
                <button
                  type="button"
                  onClick={() => setPinnedLeadId(null)}
                  className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-0.5 text-[10px] font-semibold text-zinc-300 hover:text-white cursor-pointer"
                >
                  ← Back to Stream
                </button>
              )}
              {(activeRankedItem.derivedStatus !== "UNTOUCHED" ||
                activeRankedItem.attempts > 0 ||
                callHistory.length > 0 ||
                Boolean(activeFollowUpRaw)) &&
                onResetLead && (
                  <button
                    type="button"
                    onClick={() => {
                      onResetLead(activeLead);
                      setSessionCompletedIds((prev) => {
                        const next = new Set(prev);
                        next.delete(activeLead.companyId);
                        return next;
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 px-2.5 py-0.5 text-[10px] font-bold text-rose-200 transition cursor-pointer"
                    title="Reset this lead back to Ready to Call (clears mistaken outcome or follow-up)"
                  >
                    <RotateCcw className="w-3 h-3 text-rose-300" />
                    <span>Reset to Fresh</span>
                  </button>
                )}
              {canEditContacts && (
                <button
                  type="button"
                  onClick={() => onOpenEditLead(activeLead)}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/40 hover:bg-zinc-800 px-2.5 py-0.5 text-[10px] font-medium text-zinc-300 hover:text-white transition cursor-pointer"
                >
                  <Pencil className="w-3 h-3 text-zinc-400" />
                  <span>Edit Lead</span>
                </button>
              )}
            </div>
          </div>

          {/* Company Title + Location & Links Row */}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                {activeLead.name}
              </h2>
              <CallStatusBadge
                lead={activeLead}
                showAttempts
                showLastCalled
              />
              {typeof activeLead.icpScore === "number" && (
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                  Score {activeLead.icpScore}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
              <span className="inline-flex items-center gap-1 text-zinc-300 font-medium">
                <Building2 className="w-3.5 h-3.5 text-zinc-500" />
                <span>
                  {activeLead.city
                    ? `${activeLead.city}, ${activeLead.state}`
                    : activeLead.state || "United States"}
                </span>
              </span>

              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white inline-flex items-center gap-1 transition text-zinc-400"
              >
                <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                <span>Google Maps</span>
              </a>

              {activeLead.website && (
                <a
                  href={
                    activeLead.website.startsWith("http")
                      ? activeLead.website
                      : `https://${activeLead.website}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white inline-flex items-center gap-1 transition text-sky-400"
                >
                  <span>
                    {activeLead.website
                      .replace(/^https?:\/\//i, "")
                      .replace(/\/$/, "")}
                  </span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}

              {dmEmail && (
                <a
                  href={`mailto:${dmEmail}`}
                  className="hover:text-white inline-flex items-center gap-1 transition text-zinc-400"
                >
                  <Mail className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="truncate max-w-[180px]">{dmEmail}</span>
                </a>
              )}
            </div>
          </div>

          {/* HERO DIALER & DECISION MAKER CARD */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-black/80 via-emerald-950/20 to-black/80 px-3.5 py-2.5 items-center shadow-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400">
                Decision Maker
              </div>
              <div className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
                <span>{dmName || "Owner / Managing Principal"}</span>
                {canEditContacts && (
                  <button
                    type="button"
                    onClick={() => onOpenEditLead(activeLead)}
                    className="text-zinc-500 hover:text-white cursor-pointer"
                    title="Update Owner Name"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="text-xs text-zinc-400">
                {dmTitle || "Primary Decision Maker"}
              </div>
            </div>

            <div className="flex flex-col sm:items-end gap-1">
              {cleanDialPhone ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      copyText(cleanDialPhone, `phone_${activeLead.companyId}`)
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold px-3.5 py-1.5 text-sm font-mono tracking-wider transition shadow-md cursor-pointer"
                    title="Click or press Spacebar to copy clean phone number"
                  >
                    <Phone className="w-3.5 h-3.5 fill-black" />
                    <span>{cleanDialPhone}</span>
                    {copiedKey === `phone_${activeLead.companyId}` ? (
                      <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] font-sans font-bold">
                        Copied!
                      </span>
                    ) : (
                      <Copy className="w-3.5 h-3.5 opacity-75" />
                    )}
                  </button>

                  <a
                    href={`tel:${cleanDialPhone}`}
                    className="inline-flex items-center justify-center p-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-emerald-400 transition"
                    title="Dial in phone app (tel:)"
                  >
                    <PhoneCall className="w-4 h-4" />
                  </a>
                </div>
              ) : (
                canEditContacts && (
                  <button
                    type="button"
                    onClick={() => onOpenEditLead(activeLead)}
                    className="text-xs font-semibold text-amber-300 underline cursor-pointer"
                  >
                    + Add Phone Number
                  </button>
                )
              )}
              <span className="text-[10px] text-zinc-400">
                <kbd className="px-1 py-0.2 rounded bg-black/60 border border-white/10 text-zinc-300 font-mono">
                  Space
                </kbd>{" "}
                copy number &bull;{" "}
                <kbd className="px-1 py-0.2 rounded bg-black/60 border border-white/10 text-zinc-300 font-mono">
                  1–7
                </kbd>{" "}
                outcome &bull;{" "}
                <kbd className="px-1 py-0.2 rounded bg-black/60 border border-white/10 text-zinc-300 font-mono">
                  [ / ]
                </kbd>{" "}
                prev/next
              </span>
            </div>
          </div>

          {/* 3 FLASH BATTLECARDS */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="rounded-xl border border-rose-500/30 bg-gradient-to-b from-rose-950/20 to-black/40 p-2.5 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                <Target className="w-3 h-3 text-rose-400 shrink-0" />
                <span>Why Call (Pain Point)</span>
              </div>
              <p className="text-xs text-zinc-100 font-medium leading-snug">
                {battlecard.painTrigger}
              </p>
            </div>

            <div className="rounded-xl border border-sky-500/30 bg-gradient-to-b from-sky-950/20 to-black/40 p-2.5 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-300">
                <Building2 className="w-3 h-3 text-sky-400 shrink-0" />
                <span>Company Profile</span>
              </div>
              <p className="text-xs text-zinc-100 font-medium leading-snug">
                {battlecard.scaleAndTech}
              </p>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-gradient-to-b from-amber-950/20 to-black/40 p-2.5 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                <Shield className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Receptionist Tip</span>
              </div>
              <p className="text-xs text-zinc-100 font-medium leading-snug">
                {battlecard.gatekeeperTip}
              </p>
            </div>
          </div>

          {/* SCRIPT & LIVE OBJECTION SWITCHER (READABLE HEIGHT, NO MICRO-SCROLLBAR) */}
          <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-b from-indigo-950/20 to-black/40 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-indigo-500/20 pb-1.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-xs font-bold text-indigo-200">
                  Call Script &amp; Objections
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {[
                  { key: "OPENING" as const, label: "Opener" },
                  { key: "GATEKEEPER" as const, label: "Receptionist" },
                  { key: "OBJ_BUSY" as const, label: "Busy" },
                  { key: "OBJ_CURRENT_SYSTEM" as const, label: "Have CRM" },
                  { key: "OBJ_SEND_EMAIL" as const, label: "Send Email" },
                  { key: "OBJ_PRICE" as const, label: "Pricing" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveScriptTab(tab.key)}
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold transition cursor-pointer ${
                      activeScriptTab === tab.key
                        ? "bg-indigo-500 text-white shadow-sm"
                        : "bg-black/50 text-indigo-200 hover:text-white border border-indigo-500/20"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      battlecard.scripts[activeScriptTab],
                      `script_${activeScriptTab}`
                    )
                  }
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/40 text-zinc-300 hover:text-white border border-white/10 inline-flex items-center gap-1 cursor-pointer"
                  title="Copy script text"
                >
                  {copiedKey === `script_${activeScriptTab}` ? (
                    <Check className="w-2.5 h-2.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-2.5 h-2.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-black/60 border border-indigo-500/20 text-indigo-100 text-xs sm:text-[13px] leading-relaxed font-sans select-text max-h-40 overflow-y-auto">
              {battlecard.scripts[activeScriptTab]}
            </div>
          </div>

          {/* CALL LOG TIMELINE (READABLE PROPORTIONS) */}
          {callHistory.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/40 p-2.5 space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex flex-wrap items-center justify-between gap-2">
                <span>Previous Call History ({callHistory.length})</span>
                <div className="flex items-center gap-2">
                  {activeFollowUpRaw && (
                    <span className="text-amber-300 font-semibold">
                      Next Callback: {activeFollowUpInfo.text}
                    </span>
                  )}
                  {onResetLead && (
                    <button
                      type="button"
                      onClick={() => {
                        onResetLead(activeLead);
                        setSessionCompletedIds((prev) => {
                          const next = new Set(prev);
                          next.delete(activeLead.companyId);
                          return next;
                        });
                      }}
                      className="text-[10px] font-bold text-rose-300 hover:text-rose-200 underline cursor-pointer normal-case"
                      title="Reset lead outcome and clear all active call history back to Ready to Call"
                    >
                      ↺ Reset Lead to Fresh
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {callHistory.slice(0, 5).map((entry, idx) => {
                  const def = CALL_STATUS_DEFS[entry.outcome];
                  return (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-2 text-xs p-1.5 rounded-lg bg-[#121215] border border-white/5"
                    >
                      <div className="min-w-0">
                        <span
                          className={`inline-block rounded px-1.5 py-0.2 text-[10px] font-bold mr-1.5 border ${def.badge}`}
                        >
                          {def.label}
                        </span>
                        <span className="text-zinc-200">{entry.text}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {entry.timestampRaw}
                        </span>
                        {onDeleteCallLog && (
                          <button
                            type="button"
                            onClick={() => onDeleteCallLog(activeLead, idx)}
                            className="p-0.5 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                            title="Delete this call log entry"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* RIGHT COLUMN (5 cols): OUTCOME, SMART FOLLOW-UP & NOTES CONSOLE   */}
        {/* ----------------------------------------------------------------- */}
        <div className="lg:col-span-5 rounded-2xl border border-white/10 bg-[#121215]/90 backdrop-blur-xl p-3.5 space-y-3 shadow-lg">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <PhoneCall className="w-3.5 h-3.5 text-emerald-400" />
                <span>Log Call Outcome</span>
              </h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Pick outcome (1–7) &bull; Check callback time &bull; Press Enter
              </p>
            </div>
            {selectedOutcome && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                {CALL_STATUS_DEFS[selectedOutcome].label}
              </span>
            )}
          </div>

          {/* 7 DISPOSITION BUTTONS */}
          <div className="grid grid-cols-2 gap-1.5">
            {DISPOSITION_BUTTONS.map((btn) => {
              const isSelected = selectedOutcome === btn.key;
              return (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => handleSelectDisposition(btn)}
                  className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between gap-0.5 cursor-pointer ${
                    btn.key === "MEETING_BOOKED" ? "col-span-2" : ""
                  } ${isSelected ? btn.activeClass : btn.accentClass}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold">{btn.label}</span>
                    <kbd className="px-1.5 py-0.2 rounded bg-black/50 border border-white/10 text-[10px] font-mono opacity-80">
                      {btn.hotkey}
                    </kbd>
                  </div>
                  <span className="text-[10px] opacity-75">{btn.sublabel}</span>
                </button>
              );
            })}
          </div>

          {/* 1-TAP SMART NOTE CHIPS */}
          {selectedOutcome && quickChips.length > 0 && (
            <div className="space-y-1.5 animate-in fade-in duration-150">
              <div className="text-[10px] font-semibold text-zinc-400 flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-emerald-400" />
                <span>1-Click Call Notes:</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {quickChips.map((chip) => {
                  const isUsed = noteText.includes(chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => {
                        setNoteText((prev) =>
                          prev.includes(chip)
                            ? prev
                            : prev.trim()
                            ? `${prev.trim()}, ${chip}`
                            : chip
                        );
                      }}
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium border transition cursor-pointer ${
                        isUsed
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                          : "border-white/10 bg-black/40 text-zinc-300 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      + {chip}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* FOLLOW-UP SCHEDULER (ALWAYS VISIBLE FOR NON-TERMINAL OUTCOMES OR EXISTING CALLBACKS) */}
          {(!selectedOutcome ||
            (selectedOutcome !== "NOT_INTERESTED" &&
              selectedOutcome !== "WRONG_NUMBER")) && (
            <div className="rounded-xl border border-amber-500/30 bg-gradient-to-b from-amber-950/20 to-black/40 p-2.5 space-y-2 animate-in fade-in duration-150">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-[11px] font-bold text-amber-200 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-amber-400" />
                  <span>Schedule Callback (Optional)</span>
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {[
                    { label: "+3h", preset: "LATER_TODAY" as const },
                    { label: "Tomorrow", preset: "TOMORROW" as const },
                    { label: "+2d", preset: "TWO_DAYS" as const },
                    { label: "Next Wk", preset: "NEXT_WEEK" as const },
                  ].map((p) => (
                    <button
                      key={p.preset}
                      type="button"
                      onClick={() => {
                        const nextIso = buildPresetFollowUpIso(
                          p.preset,
                          activeLead.state
                        );
                        setFollowUpDate(nextIso);
                        setFollowUpPresetUsed(p.preset);
                        setAutoCadenceReason(null);
                      }}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border transition cursor-pointer ${
                        followUpPresetUsed === p.preset
                          ? "bg-amber-400 text-black border-amber-300 font-bold"
                          : "border-white/10 bg-black/50 text-amber-300 hover:bg-zinc-900"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                  {followUpDate && (
                    <button
                      type="button"
                      onClick={() => {
                        setFollowUpDate("");
                        setFollowUpPresetUsed("CLEARED");
                        setAutoCadenceReason(null);
                      }}
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold border border-white/10 bg-black/50 text-zinc-400 hover:text-white transition cursor-pointer"
                      title="Clear callback date"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={followUpDate}
                  onChange={(e) => {
                    setFollowUpDate(e.target.value);
                    setFollowUpPresetUsed("CUSTOM");
                    setAutoCadenceReason(null);
                  }}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-black/60 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                />
                {!selectedOutcome &&
                  onRescheduleFollowUp &&
                  followUpDate &&
                  followUpDate !== (activeLead.nextFollowUp || "") && (
                    <button
                      type="button"
                      onClick={() =>
                        handleDirectReschedule(
                          activeLead,
                          followUpDate,
                          noteText.trim() || "Updated callback schedule",
                          false
                        )
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-bold text-[11px] shrink-0 transition cursor-pointer"
                      title="Save callback time without logging a call"
                    >
                      Save Callback
                    </button>
                  )}
              </div>

              {followUpDate ? (
                <div className="flex items-center justify-between text-[10px] text-amber-200/90 px-0.5">
                  <span>
                    📅{" "}
                    <strong>
                      {formatFollowUpLabel(followUpDate, activeLead.state).text}
                    </strong>
                  </span>
                  {autoCadenceReason && (
                    <span className="text-zinc-400 truncate max-w-[180px]">
                      {autoCadenceReason}
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-[10px] text-zinc-400 px-0.5">
                  No callback scheduled — only pick a time above if this lead needs a follow-up.
                </div>
              )}
            </div>
          )}

          {/* CALL NOTES INPUT */}
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-zinc-300">
              Call Notes (Saved to Lead History)
            </label>
            <textarea
              rows={2}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Write summary (e.g. spoke to receptionist Sarah, owner in after 2pm)..."
              className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none resize-y"
            />
          </div>

          {validationHint && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
              {validationHint}
            </div>
          )}

          {/* CONFIRM & ADVANCE BUTTON */}
          <button
            type="button"
            disabled={!selectedOutcome}
            onClick={() => {
              if (!selectedOutcome) {
                setValidationHint("Select a call outcome (1–7) above first.");
                return;
              }
              commitDisposition(selectedOutcome);
            }}
            className={`w-full inline-flex items-center justify-center gap-2 rounded-xl font-extrabold py-2.5 px-3 text-xs transition shadow-md cursor-pointer ${
              selectedOutcome
                ? "bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/25 ring-2 ring-emerald-400/50"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700/60"
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {selectedOutcome
                ? `Save "${CALL_STATUS_DEFS[selectedOutcome].label}" & Next Lead → (Enter)`
                : "Select Call Outcome (1–7) Above"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
