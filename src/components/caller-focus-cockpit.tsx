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
import { type NicheSmartField } from "@/server/domain/niche-fields";
import {
  buildPresetFollowUpIso,
  formatFollowUpLabel,
} from "@/components/crm-lead-sheet";
import { CallStatusBadge } from "@/components/call-status-ui";
import { US_TZ_GROUPS, wallClock } from "@/server/domain/call-time";
import {
  PhoneCall,
  Phone,
  Copy,
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
  Award,
  Globe,
} from "lucide-react";

export interface FocusCockpitSubmitPayload {
  lead: CallerLeadView;
  outcome: CallOutcomeKey;
  callerNotes: string;
  followUpDate: string | null;
  softwareConfirmed?: string | null;
  fleetSizeConfirmed?: number | null;
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
  onSmartFieldChange?: (lead: CallerLeadView, field: NicheSmartField, nextVal: string) => void;
  onOpenEditLead: (lead: CallerLeadView) => void;
  onSwitchToFullCrm?: (filterStatus?: string) => void;
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
    sublabel: "Auto +4h / Next Window",
    accentClass: "border-white/10 bg-[#09090b]/80 hover:border-slate-500 text-slate-200",
    activeClass: "border-slate-300 bg-slate-500/25 text-white ring-2 ring-slate-400 shadow-md",
  },
  {
    key: "CALL_COMPLETED",
    hotkey: "2",
    label: "Left Voicemail",
    sublabel: "Auto +48h Cadence",
    accentClass: "border-white/10 bg-[#09090b]/80 hover:border-violet-500 text-violet-200",
    activeClass: "border-violet-300 bg-violet-500/25 text-white ring-2 ring-violet-400 shadow-md",
  },
  {
    key: "GATEKEEPER_BLOCKED",
    hotkey: "3",
    label: "Gatekeeper",
    sublabel: "Auto GK Bypass Hour",
    accentClass: "border-white/10 bg-[#09090b]/80 hover:border-amber-500 text-amber-200",
    activeClass: "border-amber-300 bg-amber-500/25 text-white ring-2 ring-amber-400 shadow-md",
  },
  {
    key: "CONNECTED",
    hotkey: "4",
    label: "Connected (Owner)",
    sublabel: "Spoke to Decision Maker",
    accentClass: "border-white/10 bg-[#09090b]/80 hover:border-sky-500 text-sky-200",
    activeClass: "border-sky-300 bg-sky-500/30 text-white ring-2 ring-sky-400 shadow-md",
  },
  {
    key: "MEETING_BOOKED",
    hotkey: "5",
    label: "Meeting Booked 🎉",
    sublabel: "Demo Confirmed",
    accentClass: "border-emerald-500/30 bg-emerald-950/20 hover:border-emerald-400 text-emerald-200",
    activeClass: "border-emerald-300 bg-emerald-500/30 text-white ring-2 ring-emerald-400 shadow-md",
  },
  {
    key: "NOT_INTERESTED",
    hotkey: "6",
    label: "Not Interested",
    sublabel: "Owner Declined",
    accentClass: "border-white/10 bg-[#09090b]/80 hover:border-rose-500 text-rose-200",
    activeClass: "border-rose-300 bg-rose-500/25 text-white ring-2 ring-rose-400 shadow-md",
  },
  {
    key: "WRONG_NUMBER",
    hotkey: "7",
    label: "Wrong Number",
    sublabel: "Disconnected / Bad Line",
    accentClass: "border-white/10 bg-[#09090b]/80 hover:border-pink-500 text-pink-200",
    activeClass: "border-pink-300 bg-pink-500/25 text-white ring-2 ring-pink-400 shadow-md",
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
  onSmartFieldChange,
  onOpenEditLead,
  onSwitchToFullCrm,
}: CallerFocusCockpitProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [cursorIndex, setCursorIndex] = useState<number>(0);
  const [pinnedLeadId, setPinnedLeadId] = useState<string | null>(null);
  const [sessionStreak, setSessionStreak] = useState<number>(0);
  const [sessionCompletedIds, setSessionCompletedIds] = useState<Set<string>>(() => new Set());

  // Active Disposition State
  const [selectedOutcome, setSelectedOutcome] = useState<CallOutcomeKey | null>(null);
  const [noteText, setNoteText] = useState<string>("");
  const [followUpDate, setFollowUpDate] = useState<string>("");
  const [followUpPresetUsed, setFollowUpPresetUsed] = useState<string | null>(null);
  const [activeScriptTab, setActiveScriptTab] = useState<ScriptTabKey>("OPENING");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [validationHint, setValidationHint] = useState<string | null>(null);

  // Unified Built-In Drawers (Lookup Drawer & Personal Analytics Drawer)
  const [activeDrawer, setActiveDrawer] = useState<"NONE" | "LOOKUP" | "ANALYTICS">("NONE");
  const [lookupQuery, setLookupQuery] = useState<string>("");
  const [lookupTab, setLookupTab] = useState<"FOLLOW_UPS" | "ALL" | "MEETINGS">("FOLLOW_UPS");

  // Update clock every 15s so overdue follow-ups hijack stream in real time
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  // Rank all leads into the intelligent Focus Stream
  const rankedStream = useMemo(
    () => rankLeadsForFocusStream(leads, nowMs),
    [leads, nowMs]
  );

  const mandatoryDueCount = useMemo(
    () => rankedStream.filter((r) => r.tier === "MANDATORY_FOLLOW_UP_DUE").length,
    [rankedStream]
  );

  // Stream of uncontacted leads for this active calling session
  const uncontactedStream = useMemo(
    () => rankedStream.filter((r) => !sessionCompletedIds.has(r.lead.companyId)),
    [rankedStream, sessionCompletedIds]
  );

  // Resolve current active item in stream (advances automatically to next uncontacted lead)
  const activeRankedItem = useMemo(() => {
    if (pinnedLeadId) {
      const found = rankedStream.find((r) => r.lead.companyId === pinnedLeadId);
      if (found) return found;
      // Fallback: when caller manually clicks a scheduled callback in drawer that is
      // held back from the normal stream (e.g. scheduled for later), immediately load it!
      const directLead = leads.find((l) => l.companyId === pinnedLeadId);
      if (directLead) {
        const derived = deriveCallStatus(directLead);
        const fuIso = directLead.nextFollowUp || extractFollowUp(directLead.notes);
        return {
          lead: directLead,
          priorityScore: 999_999,
          tier: "MANDATORY_FOLLOW_UP_DUE" as const,
          reasonBadge: "📌 Pinned Callback",
          isMandatoryFollowUpLock: false,
          overdueMinutes: 0,
          followUpIso: fuIso,
          derivedStatus: derived.key,
          attempts: derived.attempts,
          localTime: computeProspectLocalTimeInfo(directLead.state, nowMs),
        };
      }
    }
    if (uncontactedStream.length === 0) return null;
    if (uncontactedStream[0]?.isMandatoryFollowUpLock) {
      return uncontactedStream[0];
    }
    const safeIdx = Math.min(Math.max(0, cursorIndex), uncontactedStream.length - 1);
    return uncontactedStream[safeIdx] || uncontactedStream[0]!;
  }, [leads, rankedStream, uncontactedStream, cursorIndex, pinnedLeadId]);

  const activeLead = activeRankedItem?.lead ?? null;
  const activeLeadId = activeLead?.companyId ?? null;

  // Reset local disposition inputs ONLY when the lead changes
  useEffect(() => {
    setSelectedOutcome(null);
    setNoteText("");
    setFollowUpDate("");
    setFollowUpPresetUsed(null);
    setActiveScriptTab("OPENING");
    setValidationHint(null);
  }, [activeLeadId]);

  // Clean raw phone number (removes brackets, dashes, spaces)
  const rawDialPhone = activeLead?.bestContact.phone || activeLead?.phone || "";
  const cleanDialPhone = rawDialPhone.replace(/\D/g, "");

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // Commit outcome & advance to next lead in stream
  const commitDisposition = (
    outcomeToCommit: CallOutcomeKey,
    overrideNotes?: string,
    overrideFollowUp?: string | null
  ) => {
    if (!activeLead) return;

    const dialedId = activeLead.companyId;
    const finalNotes = (overrideNotes !== undefined ? overrideNotes : noteText).trim();
    const rawExplicitFollowUp =
      overrideFollowUp !== undefined ? overrideFollowUp : followUpDate.trim() || null;

    const autoCadence = computeAutoFollowUpCadence({
      outcome: outcomeToCommit,
      previousAttempts: activeRankedItem?.attempts ?? 0,
      explicitFollowUpDate: rawExplicitFollowUp,
      nowMs,
    });

    const finalFollowUp = autoCadence.nextFollowUpIso;

    setSessionStreak((s) => s + 1);
    setSessionCompletedIds((prev) => {
      const next = new Set(prev);
      next.add(dialedId);
      return next;
    });
    setPinnedLeadId(null);
    setCursorIndex(0);

    onLogCallAndAdvance({
      lead: activeLead,
      outcome: outcomeToCommit,
      callerNotes: finalNotes,
      followUpDate: finalFollowUp,
    });
  };

  // Handle clicking one of the 7 Disposition Buttons:
  // Strictly SELECTS the outcome; DOES NOT advance until caller confirms!
  const handleSelectDisposition = (btn: (typeof DISPOSITION_BUTTONS)[number]) => {
    setValidationHint(null);
    setSelectedOutcome(btn.key);

    // Pre-fill smart follow-up preset for Connected / Gatekeeper if none picked yet
    if (btn.key === "CONNECTED" && !followUpDate) {
      const tomorrowIso = buildPresetFollowUpIso("TOMORROW");
      setFollowUpDate(tomorrowIso);
      setFollowUpPresetUsed("TOMORROW");
    } else if (btn.key === "GATEKEEPER_BLOCKED" && !followUpDate) {
      const auto = computeAutoFollowUpCadence({
        outcome: "GATEKEEPER_BLOCKED",
        previousAttempts: activeRankedItem?.attempts ?? 0,
        nowMs,
      });
      if (auto.nextFollowUpIso) {
        setFollowUpDate(auto.nextFollowUpIso);
        setFollowUpPresetUsed("AUTO_GK");
      }
    }
  };

  // Keyboard shortcuts:
  // Space: Copy clean raw phone number (no brackets, no hyphens)
  // 1–7: Select outcome button
  // Enter: Confirm selected outcome and advance to next lead
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!activeLead) return;

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
    const q = lookupQuery.trim().toLowerCase();
    return leads
      .filter((l) => {
        if (l.status === "REJECTED") return false;
        if (lookupTab === "FOLLOW_UPS") {
          const fu = l.nextFollowUp || extractFollowUp(l.notes);
          if (!fu) return false;
        } else if (lookupTab === "MEETINGS") {
          if (l.status !== "MEETING_BOOKED" && deriveCallStatus(l).key !== "MEETING_BOOKED")
            return false;
        }
        if (!q) return true;
        return (
          l.name.toLowerCase().includes(q) ||
          (l.bestContact.name && l.bestContact.name.toLowerCase().includes(q)) ||
          (l.phone && l.phone.includes(q)) ||
          (l.bestContact.phone && l.bestContact.phone.includes(q)) ||
          (l.city && l.city.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (lookupTab === "FOLLOW_UPS") {
          const fuA = a.nextFollowUp || extractFollowUp(a.notes) || "";
          const fuB = b.nextFollowUp || extractFollowUp(b.notes) || "";
          const tA = fuA ? Date.parse(fuA) : Infinity;
          const tB = fuB ? Date.parse(fuB) : Infinity;
          return tA - tB;
        }
        return 0;
      })
      .slice(0, 50);
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
            {hasCompletedSome ? "Calling Round Complete 🎉" : "Active Calling Stream is Clear!"}
          </h2>
          <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
            {hasCompletedSome
              ? `Great session! You have dialed all ${sessionCompletedIds.size} leads in your active assigned pool.`
              : "All assigned leads in your stream have been called or scheduled."}
          </p>
        </div>

        {hasCompletedSome && (
          <div className="inline-flex items-center gap-2 rounded-full bg-black/50 border border-white/10 px-4 py-1.5 text-xs text-zinc-300">
            <span>Session Dials: <strong className="text-emerald-400 font-mono">{sessionStreak}</strong></span>
            <span>•</span>
            <span>Answered: <strong className="text-sky-300 font-mono">{telemetry.answeredLeads}</strong></span>
            <span>•</span>
            <span>Meetings: <strong className="text-emerald-400 font-mono">{telemetry.meetingsBooked}</strong></span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          {hasCompletedSome && (
            <button
              type="button"
              onClick={() => {
                setSessionCompletedIds(new Set());
                setCursorIndex(0);
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold px-4 py-2 text-xs transition shadow-sm"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Start Next Dialing Round</span>
            </button>
          )}

          {onSwitchToFullCrm && (
            <button
              type="button"
              onClick={() => onSwitchToFullCrm("ALL")}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold px-4 py-2 text-xs transition border border-white/10 shadow-sm"
            >
              <span>View Full Pipeline ({leads.length} Leads)</span>
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

  const quickChips = selectedOutcome ? getQuickNoteChipsForOutcome(selectedOutcome) : [];

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${activeLead.name} ${activeLead.address || ""} ${activeLead.city || ""} ${activeLead.state || ""}`
  )}`;

  // Total actionable leads waiting to be called in this active stream
  const totalToCall = rankedStream.length;
  const completedInSession = sessionCompletedIds.size;
  const currentLeadPosition = Math.min(completedInSession + 1, Math.max(1, totalToCall));

  return (
    <div className="space-y-2">
      {/* =================================================================== */}
      {/* 1. ULTRA-COMPACT HUD BAR WITH PROMINENT LIVE LEAD COUNTER          */}
      {/* =================================================================== */}
      <div className="rounded-xl border border-white/10 bg-[#121215]/80 backdrop-blur-xl px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* Prominent Live Lead Counter Bubble: e.g. Lead 3 of 20 */}
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/30 px-3 py-1 text-xs font-bold text-emerald-300 shadow-sm">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>
              Lead {pinnedLeadId ? "(Callback)" : `${currentLeadPosition} of ${totalToCall}`}
            </span>
          </div>

          {sessionStreak > 0 && (
            <div className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
              <Flame className="w-3 h-3 text-amber-400" />
              <span>{sessionStreak} Streak</span>
            </div>
          )}

          {sessionCompletedIds.size > 0 && (
            <button
              type="button"
              onClick={() => {
                setSessionCompletedIds(new Set());
                setCursorIndex(0);
              }}
              className="text-[10px] text-zinc-400 hover:text-white underline underline-offset-2 ml-0.5 font-medium"
              title="Reset active dialing round to start over from lead 1"
            >
              Restart Round ({sessionCompletedIds.size} dialed)
            </button>
          )}

          {/* Compact Live Telemetry Bubbles */}
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="rounded-full bg-black/40 border border-white/10 px-2.5 py-0.5 text-zinc-300">
              Dials: <strong className="text-sky-300 font-mono">{telemetry.totalCallsDialed}</strong>
            </span>
            <span className="rounded-full bg-black/40 border border-white/10 px-2.5 py-0.5 text-zinc-300">
              Answered: <strong className="text-cyan-300 font-mono">{telemetry.answeredLeads}</strong>{" "}
              <span className="text-[9px] text-zinc-500">({telemetry.answerRatePct}%)</span>
            </span>
            <span className="rounded-full bg-black/40 border border-white/10 px-2.5 py-0.5 text-zinc-300">
              Spoke: <strong className="text-indigo-300 font-mono">{telemetry.connectedLeads}</strong>
            </span>
            <span className="rounded-full bg-black/40 border border-emerald-500/30 px-2.5 py-0.5 text-zinc-200">
              Meetings: <strong className="text-emerald-400 font-mono">{telemetry.meetingsBooked}</strong>
            </span>
          </div>
        </div>

        {/* Built-in Drawer Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              setActiveDrawer(activeDrawer === "LOOKUP" ? "NONE" : "LOOKUP")
            }
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
              activeDrawer === "LOOKUP"
                ? "border-amber-400 bg-amber-500/20 text-amber-200"
                : mandatoryDueCount > 0
                ? "border-rose-500/50 bg-rose-500/20 text-rose-200 animate-pulse"
                : "border-white/10 bg-black/40 text-zinc-300 hover:text-white hover:border-zinc-700"
            }`}
          >
            <Search className="w-3 h-3 text-amber-400" />
            <span>Callbacks</span>
            {Math.max(dynamicFollowUpsCount, telemetry.followUpsScheduled) > 0 && (
              <span className="rounded-full bg-amber-500/30 border border-amber-400/40 px-1.5 text-[9px] font-bold text-amber-200">
                {Math.max(dynamicFollowUpsCount, telemetry.followUpsScheduled)}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveDrawer(activeDrawer === "ANALYTICS" ? "NONE" : "ANALYTICS")
            }
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
              activeDrawer === "ANALYTICS"
                ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                : "border-white/10 bg-black/40 text-zinc-300 hover:text-white hover:border-zinc-700"
            }`}
          >
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <span>Radar</span>
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* 1.5 INLINE DRAWERS                                                  */}
      {/* =================================================================== */}
      {activeDrawer === "LOOKUP" && (
        <div className="rounded-xl border border-amber-500/30 bg-[#121215]/95 backdrop-blur-xl p-3 space-y-2 shadow-2xl animate-in fade-in duration-150">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold text-white">
                Scheduled Callbacks
              </span>
              <div className="flex items-center gap-1 ml-2">
                {[
                  {
                    id: "FOLLOW_UPS" as const,
                    label: `Follow-Ups (${Math.max(dynamicFollowUpsCount, telemetry.followUpsScheduled)})`,
                  },
                  { id: "MEETINGS" as const, label: `Meetings (${telemetry.meetingsBooked})` },
                  { id: "ALL" as const, label: `All Queue (${leads.length})` },
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
              <div className="relative w-44">
                <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-2" />
                <input
                  type="text"
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  placeholder="Find company..."
                  className="w-full rounded-full border border-white/10 bg-black/50 pl-7 pr-2 py-1 text-[11px] text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                />
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
            <div className="py-4 text-center text-xs text-zinc-500">
              No matching leads found.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
              {lookupLeads.map((item) => {
                const targetFu = item.nextFollowUp || extractFollowUp(item.notes);
                const fu = formatFollowUpLabel(targetFu, item.state);
                const isCurrent = activeLead ? item.companyId === activeLead.companyId : false;
                const leadCleanPhone = (item.bestContact.phone || item.phone || "").replace(/\D/g, "");
                return (
                  <button
                    key={item.companyId}
                    type="button"
                    onClick={() => {
                      setPinnedLeadId(item.companyId);
                      setActiveDrawer("NONE");
                    }}
                    className={`p-2.5 rounded-xl border text-left transition flex items-start justify-between gap-1.5 cursor-pointer ${
                      isCurrent
                        ? "border-emerald-400 bg-emerald-500/15"
                        : "border-white/10 bg-black/40 hover:border-amber-400/50 hover:bg-zinc-900/80"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">
                        {item.bestContact.name || "Owner"} &bull;{" "}
                        <span className="font-mono text-emerald-400">
                          {leadCleanPhone}
                        </span>
                      </div>
                      {fu.text && (
                        <div
                          className={`text-[9px] font-semibold mt-1 flex items-center gap-1 ${
                            fu.isOverdue ? "text-rose-400 font-bold" : "text-amber-300"
                          }`}
                        >
                          <span>{fu.isOverdue ? "⚠️ Overdue:" : "⏰ Due:"}</span>
                          <span className="truncate">{fu.text}</span>
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] font-bold text-emerald-400 shrink-0 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                      Load →
                    </span>
                  </button>
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
                US Local Clocks &amp; Peak Calling Radar
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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
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
                  className={`rounded-xl border px-2.5 py-1.5 text-[11px] flex items-center justify-between ${
                    isPrime
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : isBypass
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                      : "border-white/10 bg-black/40 text-zinc-400"
                  }`}
                >
                  <div>
                    <div className="font-bold text-[10px]">{tz.id}</div>
                    <div className="text-[9px] opacity-80">
                      {isPrime ? "🟢 Prime Window" : isBypass ? "⚡ GK Hour" : "Standard"}
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
      {/* 2. MANDATORY FOLLOW-UP LOCK BANNER                                  */}
      {/* =================================================================== */}
      {activeRankedItem.isMandatoryFollowUpLock && (
        <div className="rounded-xl border-2 border-amber-500/70 bg-gradient-to-r from-amber-950/60 via-black/60 to-[#121215] px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-md">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-300 shrink-0">
              <Lock className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
                  Mandatory Callback Due
                </span>
                <span className="rounded-full bg-rose-500/20 border border-rose-500/40 px-2 py-0.2 text-[9px] font-bold text-rose-200">
                  {activeRankedItem.reasonBadge}
                </span>
              </div>
              <p className="text-[11px] text-zinc-200 mt-0.5">
                Scheduled callback for <strong>{activeLead.name}</strong> ({dmName || "Owner"}) is due right now.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {callHistory[0] && (
              <div className="rounded-lg bg-black/70 border border-amber-500/30 px-2 py-1 text-[10px] text-zinc-300 max-w-sm truncate hidden sm:block">
                <span className="text-amber-300 font-semibold">Last Note: </span>
                <span>{callHistory[0].text}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                const tomorrowIso = buildPresetFollowUpIso("TOMORROW");
                commitDisposition("CALL_COMPLETED", "Rescheduled callback to tomorrow", tomorrowIso);
              }}
              className="rounded-full bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 px-2.5 py-1 text-[10px] font-bold text-amber-200 transition shrink-0"
              title="Reschedule overdue callback to tomorrow and advance immediately"
            >
              Reschedule to Tomorrow
            </button>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 3. MAIN SPLIT FOCUS COCKPIT (LEFT: INTEL & SCRIPT | RIGHT: OUTCOME) */}
      {/* =================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-start">
        {/* ----------------------------------------------------------------- */}
        {/* LEFT COLUMN (7 cols): INTEL, DIALER & SCRIPT                      */}
        {/* ----------------------------------------------------------------- */}
        <div className="lg:col-span-7 rounded-2xl border border-white/10 bg-[#121215]/85 backdrop-blur-xl p-3 space-y-2 shadow-lg">
          {/* Top Queue Position & Prospect Local Time Bar (NO SKIP BUTTON) */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-white/10 pb-2">
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
                    : activeRankedItem.localTime.windowStatus === "GATEKEEPER_BYPASS"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    : "border-white/10 bg-black/40 text-zinc-400"
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>{activeRankedItem.localTime.windowLabel}</span>
              </span>
            </div>

            {/* Position indicator */}
            <div className="flex items-center gap-1.5">
              {pinnedLeadId && (
                <button
                  type="button"
                  onClick={() => setPinnedLeadId(null)}
                  className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold text-zinc-300 hover:text-white"
                >
                  Back to Stream
                </button>
              )}
              <span className="text-[10px] font-mono text-zinc-400 px-1">
                Lead #{pinnedLeadId ? "Callback" : `${currentLeadPosition} of ${totalToCall}`}
              </span>
            </div>
          </div>

          {/* Company Title + Quick Metadata Row */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-0.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-extrabold text-white tracking-tight truncate max-w-sm">
                  {activeLead.name}
                </h2>
                <CallStatusBadge lead={activeLead} showAttempts showLastCalled />
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.2 text-[10px] font-bold text-emerald-400">
                  ICP {activeLead.icpScore}/100
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-zinc-400">
                <span className="inline-flex items-center gap-1 text-zinc-300 font-medium">
                  <Building2 className="w-3 h-3 text-zinc-500" />
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
                  <MapPin className="w-3 h-3 text-zinc-500" />
                  <span>Maps</span>
                </a>

                {activeLead.website && (
                  <a
                    href={activeLead.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white inline-flex items-center gap-1 transition text-zinc-400"
                  >
                    <span>
                      {activeLead.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                    </span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}

                {dmEmail && (
                  <a
                    href={`mailto:${dmEmail}`}
                    className="hover:text-white inline-flex items-center gap-1 transition text-zinc-400"
                  >
                    <Mail className="w-3 h-3 text-zinc-500" />
                    <span className="truncate max-w-[130px]">{dmEmail}</span>
                  </a>
                )}
              </div>
            </div>

            {/* Edit Lead — Strictly Owner only */}
            {isOwner && canEditContacts && (
              <button
                type="button"
                onClick={() => onOpenEditLead(activeLead)}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/40 hover:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300 hover:text-white transition"
              >
                <Pencil className="w-3 h-3 text-zinc-400" />
                <span>Edit</span>
              </button>
            )}
          </div>

          {/* HERO DIALER & DECISION MAKER CARD (RAW NUMBERS: NO BRACKETS, NO HYPHENS) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-black/80 via-emerald-950/20 to-black/80 px-3 py-2 items-center shadow-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400">
                Decision Maker
              </div>
              <div className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
                <span>{dmName || "Owner / Managing Principal"}</span>
                {isOwner && canEditContacts && (
                  <button
                    type="button"
                    onClick={() => onOpenEditLead(activeLead)}
                    className="text-zinc-500 hover:text-white"
                    title="Update Owner Name"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="text-[11px] text-zinc-400">
                {dmTitle || "Primary Decision Maker"}
              </div>
            </div>

            <div className="flex flex-col sm:items-end gap-1">
              {cleanDialPhone ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => copyText(cleanDialPhone, `phone_${activeLead.companyId}`)}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold px-3 py-1.5 text-sm font-mono tracking-wider transition shadow-md cursor-pointer"
                    title="Click or press Spacebar to copy clean number"
                  >
                    <Phone className="w-3.5 h-3.5 fill-black" />
                    <span>{cleanDialPhone}</span>
                    {copiedKey === `phone_${activeLead.companyId}` ? (
                      <span className="rounded bg-black/30 px-1 py-0.2 text-[10px] font-sans font-bold">
                        Copied!
                      </span>
                    ) : (
                      <Copy className="w-3.5 h-3.5 opacity-75" />
                    )}
                  </button>

                  <a
                    href={`tel:${cleanDialPhone}`}
                    className="inline-flex items-center justify-center p-1.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-emerald-400 transition"
                    title="Launch softphone (tel:)"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                  </a>
                </div>
              ) : (
                isOwner && (
                  <button
                    type="button"
                    onClick={() => onOpenEditLead(activeLead)}
                    className="text-xs font-semibold text-amber-300 underline"
                  >
                    + Add Phone Number
                  </button>
                )
              )}
              <span className="text-[9px] text-zinc-400">
                Press <kbd className="px-1 py-0.2 rounded bg-black/60 border border-white/10 text-zinc-300 font-mono">Space</kbd> copy clean &bull; Keys <kbd className="px-1 py-0.2 rounded bg-black/60 border border-white/10 text-zinc-300 font-mono">1</kbd>–<kbd className="px-1 py-0.2 rounded bg-black/60 border border-white/10 text-zinc-300 font-mono">7</kbd> select outcome
              </span>
            </div>
          </div>

          {/* 3 HIGH-CONTRAST FLASH BATTLECARDS (ZERO EM-DASHES, ZERO GENERIC VIBES) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {/* 1. Why Call / Pain Trigger */}
            <div className="rounded-xl border border-rose-500/30 bg-gradient-to-b from-rose-950/20 to-black/40 backdrop-blur-md p-2 space-y-1">
              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-rose-300">
                <Target className="w-3 h-3 text-rose-400 shrink-0" />
                <span>Why Call: Pain Trigger</span>
              </div>
              <p className="text-[11px] text-zinc-100 font-medium leading-snug">
                {battlecard.painTrigger}
              </p>
            </div>

            {/* 2. Scale & Tech Stack */}
            <div className="rounded-xl border border-sky-500/30 bg-gradient-to-b from-sky-950/20 to-black/40 backdrop-blur-md p-2 space-y-1">
              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-sky-300">
                <Building2 className="w-3 h-3 text-sky-400 shrink-0" />
                <span>Scale and Tech</span>
              </div>
              <p className="text-[11px] text-zinc-100 font-medium leading-snug">
                {battlecard.scaleAndTech}
              </p>
            </div>

            {/* 3. Gatekeeper Strategy */}
            <div className="rounded-xl border border-amber-500/30 bg-gradient-to-b from-amber-950/20 to-black/40 backdrop-blur-md p-2 space-y-1">
              <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
                <Shield className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Gatekeeper Strategy</span>
              </div>
              <p className="text-[11px] text-zinc-100 font-medium leading-snug">
                {battlecard.gatekeeperTip}
              </p>
            </div>
          </div>

          {/* SCRIPT & LIVE OBJECTION SWITCHER */}
          <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-b from-indigo-950/20 to-black/40 backdrop-blur-md p-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-indigo-500/20 pb-1">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-indigo-400" />
                <span className="text-[11px] font-bold text-indigo-200">
                  Script and Objections
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {[
                  { key: "OPENING" as const, label: "Opener" },
                  { key: "GATEKEEPER" as const, label: "Gatekeeper" },
                  { key: "OBJ_BUSY" as const, label: "Busy" },
                  { key: "OBJ_CURRENT_SYSTEM" as const, label: "Have CRM" },
                  { key: "OBJ_SEND_EMAIL" as const, label: "Email" },
                  { key: "OBJ_PRICE" as const, label: "Price" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveScriptTab(tab.key)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition ${
                      activeScriptTab === tab.key
                        ? "bg-indigo-500 text-white shadow-sm"
                        : "bg-black/50 text-indigo-200 hover:text-white border border-indigo-500/20"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-2 rounded-lg bg-black/60 border border-indigo-500/20 text-indigo-100 text-xs leading-relaxed font-sans select-text max-h-20 overflow-y-auto">
              {battlecard.scripts[activeScriptTab]}
            </div>
          </div>

          {/* CALL LOG TIMELINE */}
          {callHistory.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/40 p-2 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                <span>Call Log ({callHistory.length} attempts)</span>
                {activeLead.nextFollowUp && (
                  <span className="text-amber-300 font-semibold">
                    Callback: {formatFollowUpLabel(activeLead.nextFollowUp, activeLead.state).text}
                  </span>
                )}
              </div>
              <div className="space-y-1 max-h-16 overflow-y-auto pr-1">
                {callHistory.slice(0, 3).map((entry, idx) => {
                  const def = CALL_STATUS_DEFS[entry.outcome];
                  return (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-1.5 text-[11px] p-1 rounded bg-[#121215] border border-white/5"
                    >
                      <div className="min-w-0">
                        <span className={`inline-block rounded px-1 py-0.2 text-[9px] font-bold mr-1.5 border ${def.badge}`}>
                          {def.label}
                        </span>
                        <span className="text-zinc-200">{entry.text}</span>
                      </div>
                      <span className="text-[9px] text-zinc-500 shrink-0 font-mono">
                        {entry.timestampRaw}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* RIGHT COLUMN (5 cols): ZERO-SURPRISE OUTCOME CONSOLE              */}
        {/* ----------------------------------------------------------------- */}
        <div className="lg:col-span-5 rounded-2xl border border-white/10 bg-[#121215]/85 backdrop-blur-xl p-3 space-y-2.5 shadow-lg">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <PhoneCall className="w-3.5 h-3.5 text-emerald-400" />
                <span>Log Call Outcome</span>
              </h3>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                Select outcome &bull; Press Enter or click Confirm to advance
              </p>
            </div>
            {selectedOutcome && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                {CALL_STATUS_DEFS[selectedOutcome].label}
              </span>
            )}
          </div>

          {/* 7 DISPOSITION BUTTONS (CLICK SELECTS OUTCOME; DOES NOT PREMATURELY SWITCH LEAD) */}
          <div className="grid grid-cols-2 gap-1.5">
            {DISPOSITION_BUTTONS.map((btn) => {
              const isSelected = selectedOutcome === btn.key;
              return (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => handleSelectDisposition(btn)}
                  className={`p-2 rounded-xl border text-left transition flex flex-col justify-between gap-0.5 ${
                    btn.key === "MEETING_BOOKED" ? "col-span-2" : ""
                  } ${isSelected ? btn.activeClass : btn.accentClass}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-bold">{btn.label}</span>
                    <kbd className="px-1 py-0.2 rounded bg-black/50 border border-white/10 text-[9px] font-mono opacity-80">
                      {btn.hotkey}
                    </kbd>
                  </div>
                  <span className="text-[9px] opacity-75">{btn.sublabel}</span>
                </button>
              );
            })}
          </div>

          {/* 1-TAP SMART NOTE CHIPS */}
          {selectedOutcome && quickChips.length > 0 && (
            <div className="space-y-1 animate-in fade-in duration-150">
              <div className="text-[10px] font-semibold text-zinc-400 flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-emerald-400" />
                <span>Quick Notes:</span>
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
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition ${
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

          {/* FOLLOW-UP SCHEDULER (WHEN APPLICABLE) */}
          {selectedOutcome &&
            selectedOutcome !== "NOT_INTERESTED" &&
            selectedOutcome !== "WRONG_NUMBER" && (
              <div className="rounded-xl border border-amber-500/30 bg-gradient-to-b from-amber-950/20 to-black/40 p-2 space-y-1.5 animate-in fade-in duration-150">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-[10px] font-bold text-amber-200 flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-amber-400" />
                    <span>Next Callback Date</span>
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {[
                      { label: "3 Hrs", preset: "LATER_TODAY" as const },
                      { label: "Tomorrow", preset: "TOMORROW" as const },
                      { label: "+2 Days", preset: "TWO_DAYS" as const },
                      { label: "Next Week", preset: "NEXT_WEEK" as const },
                    ].map((p) => (
                      <button
                        key={p.preset}
                        type="button"
                        onClick={() => {
                          setFollowUpDate(buildPresetFollowUpIso(p.preset));
                          setFollowUpPresetUsed(p.preset);
                        }}
                        className={`rounded-full px-2 py-0.2 text-[9px] font-semibold border transition ${
                          followUpPresetUsed === p.preset
                            ? "bg-amber-400 text-black border-amber-300 font-bold"
                            : "border-white/10 bg-black/50 text-amber-300 hover:bg-zinc-900"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  type="datetime-local"
                  value={followUpDate}
                  onChange={(e) => {
                    setFollowUpDate(e.target.value);
                    setFollowUpPresetUsed("CUSTOM");
                  }}
                  className="w-full px-2 py-1 rounded-lg bg-black/60 border border-white/10 text-[11px] text-white focus:outline-none focus:border-amber-400"
                />
              </div>
            )}

          {/* OPTIONAL CALL NOTES INPUT */}
          <div className="space-y-1">
            <label className="block text-[10px] font-semibold text-zinc-400">
              Call Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add details (e.g. spoke to owner, callback after 2pm)..."
              className="w-full rounded-xl border border-white/10 bg-black/50 px-2.5 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none resize-none"
            />
          </div>

          {validationHint && (
            <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-2.5 py-1.5">
              {validationHint}
            </div>
          )}

          {/* CONFIRM & ADVANCE BUTTON */}
          <button
            type="button"
            disabled={!selectedOutcome}
            onClick={() => {
              if (!selectedOutcome) {
                setValidationHint("Select an outcome above (1–7) first.");
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
                ? `Confirm "${CALL_STATUS_DEFS[selectedOutcome].label}" & Next Lead → (Enter)`
                : "Select Call Outcome (1–7) Above"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
