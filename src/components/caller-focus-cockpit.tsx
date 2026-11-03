"use client";

import React, { useState, useMemo, useEffect } from "react";
import { type CallerLeadView } from "@/server/repo/caller";
import {
  CALL_STATUS_DEFS,
  deriveCallStatus,
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
  type NicheSmartField,
  resolveSmartFieldValue,
} from "@/server/domain/niche-fields";
import {
  buildPresetFollowUpIso,
  formatFollowUpLabel,
  stripFollowUpTagFromNotes,
} from "@/components/crm-lead-sheet";
import { CallStatusBadge } from "@/components/call-status-ui";
import { US_TZ_GROUPS, wallClock } from "@/server/domain/call-time";
import {
  PhoneCall,
  Phone,
  Copy,
  Check,
  Sparkles,
  Calendar,
  Clock,
  ShieldAlert,
  Building2,
  MapPin,
  ExternalLink,
  Mail,
  ChevronRight,
  ChevronLeft,
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
  ListFilter,
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
  canEditContacts: boolean;
  getOpeningScript: (lead: CallerLeadView) => string;
  onLogCallAndAdvance: (payload: FocusCockpitSubmitPayload) => void;
  onSmartFieldChange: (lead: CallerLeadView, field: NicheSmartField, nextVal: string) => void;
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
  instantAdvance: boolean;
  accentClass: string;
  activeClass: string;
}> = [
  {
    key: "NO_ANSWER",
    hotkey: "1",
    label: "No Answer",
    sublabel: "Auto +4h / Next Window",
    instantAdvance: true,
    accentClass: "border-zinc-800 bg-[#09090b] hover:border-slate-500/60 text-slate-200",
    activeClass: "border-slate-300 bg-slate-500/20 text-white ring-1 ring-slate-300/60",
  },
  {
    key: "CALL_COMPLETED",
    hotkey: "2",
    label: "Left Voicemail",
    sublabel: "Auto +48h Cadence",
    instantAdvance: true,
    accentClass: "border-zinc-800 bg-[#09090b] hover:border-violet-500/60 text-violet-200",
    activeClass: "border-violet-300 bg-violet-500/20 text-white ring-1 ring-violet-300/60",
  },
  {
    key: "GATEKEEPER_BLOCKED",
    hotkey: "3",
    label: "Gatekeeper",
    sublabel: "Auto GK Bypass Hour",
    instantAdvance: false,
    accentClass: "border-zinc-800 bg-[#09090b] hover:border-amber-500/60 text-amber-200",
    activeClass: "border-amber-300 bg-amber-500/20 text-white ring-1 ring-amber-300/60",
  },
  {
    key: "CONNECTED",
    hotkey: "4",
    label: "Connected (Owner)",
    sublabel: "Spoke to Decision Maker",
    instantAdvance: false,
    accentClass: "border-zinc-800 bg-[#09090b] hover:border-sky-500/60 text-sky-200",
    activeClass: "border-sky-300 bg-sky-500/25 text-white ring-1 ring-sky-300/60",
  },
  {
    key: "MEETING_BOOKED",
    hotkey: "5",
    label: "Meeting Booked 🎉",
    sublabel: "Demo / Call Confirmed",
    instantAdvance: false,
    accentClass: "border-emerald-500/30 bg-emerald-950/20 hover:border-emerald-400 text-emerald-200",
    activeClass: "border-emerald-300 bg-emerald-500/25 text-white ring-1 ring-emerald-300/70",
  },
  {
    key: "NOT_INTERESTED",
    hotkey: "6",
    label: "Not Interested",
    sublabel: "Owner Declined",
    instantAdvance: false,
    accentClass: "border-zinc-800 bg-[#09090b] hover:border-rose-500/60 text-rose-200",
    activeClass: "border-rose-300 bg-rose-500/20 text-white ring-1 ring-rose-300/60",
  },
  {
    key: "WRONG_NUMBER",
    hotkey: "7",
    label: "Wrong Number",
    sublabel: "Dead / Disconnected",
    instantAdvance: true,
    accentClass: "border-zinc-800 bg-[#09090b] hover:border-pink-500/60 text-pink-200",
    activeClass: "border-pink-300 bg-pink-500/20 text-white ring-1 ring-pink-300/60",
  },
];

export function CallerFocusCockpit({
  leads,
  telemetry,
  nicheName,
  smartFields,
  activeActorName,
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

  // Active Disposition State (reset on each lead change)
  const [selectedOutcome, setSelectedOutcome] = useState<CallOutcomeKey | null>(null);
  const [noteText, setNoteText] = useState<string>("");
  const [followUpDate, setFollowUpDate] = useState<string>("");
  const [followUpPresetUsed, setFollowUpPresetUsed] = useState<string | null>(null);
  const [activeScriptTab, setActiveScriptTab] = useState<ScriptTabKey>("OPENING");
  const [oneTapAutoAdvance, setOneTapAutoAdvance] = useState<boolean>(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [validationHint, setValidationHint] = useState<string | null>(null);

  // Unified Built-In Drawers (Lookup Drawer & Personal Analytics Drawer)
  const [activeDrawer, setActiveDrawer] = useState<"NONE" | "LOOKUP" | "ANALYTICS">("NONE");
  const [lookupQuery, setLookupQuery] = useState<string>("");
  const [lookupTab, setLookupTab] = useState<"FOLLOW_UPS" | "ALL" | "MEETINGS">("FOLLOW_UPS");

  // Update clock every 15s so overdue follow-ups hijack the stream in real time
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

  // Resolve current active item in stream
  const activeRankedItem = useMemo(() => {
    if (rankedStream.length === 0) return null;
    // If #1 is a mandatory due follow-up, strictly lock onto #1 unless caller specifically searched a callback
    if (rankedStream[0]?.isMandatoryFollowUpLock && !pinnedLeadId) {
      return rankedStream[0];
    }
    if (pinnedLeadId) {
      const found = rankedStream.find((r) => r.lead.companyId === pinnedLeadId);
      if (found) return found;
    }
    const safeIdx = Math.min(Math.max(0, cursorIndex), rankedStream.length - 1);
    return rankedStream[safeIdx] || rankedStream[0]!;
  }, [rankedStream, cursorIndex, pinnedLeadId]);

  const activeLead = activeRankedItem?.lead ?? null;
  const activeLeadId = activeLead?.companyId ?? null;

  // Reset local disposition inputs when active lead changes
  useEffect(() => {
    setSelectedOutcome(null);
    setNoteText("");
    setFollowUpDate("");
    setFollowUpPresetUsed(null);
    setActiveScriptTab("OPENING");
    setValidationHint(null);
  }, [activeLeadId]);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // Commit outcome & advance to next lead
  const commitDisposition = (
    outcomeToCommit: CallOutcomeKey,
    overrideNotes?: string,
    overrideFollowUp?: string | null
  ) => {
    if (!activeLead) return;

    const finalNotes = (overrideNotes !== undefined ? overrideNotes : noteText).trim();
    const rawExplicitFollowUp =
      overrideFollowUp !== undefined ? overrideFollowUp : followUpDate.trim() || null;

    // Enforce follow-up date when Connected with Owner
    const autoCadence = computeAutoFollowUpCadence({
      outcome: outcomeToCommit,
      previousAttempts: activeRankedItem?.attempts ?? 0,
      explicitFollowUpDate: rawExplicitFollowUp,
      nowMs,
    });

    const finalFollowUp = autoCadence.nextFollowUpIso;

    setSessionStreak((s) => s + 1);
    setPinnedLeadId(null);
    setCursorIndex(0);

    onLogCallAndAdvance({
      lead: activeLead,
      outcome: outcomeToCommit,
      callerNotes: finalNotes,
      followUpDate: finalFollowUp,
    });
  };

  // Handle clicking one of the 7 Disposition Buttons
  const handleSelectDisposition = (btn: (typeof DISPOSITION_BUTTONS)[number]) => {
    setValidationHint(null);
    setSelectedOutcome(btn.key);

    // If 1-Tap Instant Advance is enabled for No Answer / Voicemail / Wrong Number,
    // log immediately and load the next lead in 0.1s!
    if (oneTapAutoAdvance && btn.instantAdvance && !noteText.trim()) {
      commitDisposition(btn.key, "", null);
      return;
    }

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

  // Keyboard shortcuts (1-7 for outcomes, Spacebar to copy & dial phone when not focused in input/textarea)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!activeLead) return;

      if (e.code === "Space") {
        const dialPhone = activeLead.bestContact.phone || activeLead.phone;
        if (dialPhone) {
          e.preventDefault();
          copyText(dialPhone, `phone_${activeLead.companyId}`);
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

  // Lookup drawer filtered leads
  const lookupLeads = useMemo(() => {
    const q = lookupQuery.trim().toLowerCase();
    return leads
      .filter((l) => {
        if (l.status === "REJECTED") return false;
        if (lookupTab === "FOLLOW_UPS") {
          if (!l.nextFollowUp) return false;
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
      .slice(0, 40);
  }, [leads, lookupQuery, lookupTab]);

  // Empty State when all leads in stream are completed
  if (!activeLead || !activeRankedItem) {
    return (
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-10 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-white">
          Your Active Calling Stream is Clear!
        </h2>
        <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
          All assigned leads in your active stream have been dialed or completed. You can review your full CRM pipeline or extract fresh leads.
        </p>
        {onSwitchToFullCrm && (
          <button
            type="button"
            onClick={() => onSwitchToFullCrm("ALL")}
            className="inline-flex items-center gap-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold px-4 py-2 text-xs transition"
          >
            <span>View Full Pipeline ({leads.length} Leads)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  const dialPhone = activeLead.bestContact.phone || activeLead.phone;
  const dmName = activeLead.bestContact.name;
  const dmTitle = activeLead.bestContact.title;
  const dmEmail = activeLead.bestContact.email;
  const cleanNotes = stripFollowUpTagFromNotes(activeLead.notes);
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
  const showQualificationFields =
    selectedOutcome === "CONNECTED" || selectedOutcome === "MEETING_BOOKED";
  const nextUpLeads = rankedStream
    .filter((r) => r.lead.companyId !== activeLead.companyId)
    .slice(0, 2);

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${activeLead.name} ${activeLead.address || ""} ${activeLead.city || ""} ${activeLead.state || ""}`
  )}`;

  return (
    <div className="space-y-3.5">
      {/* =================================================================== */}
      {/* 1. COMPACT PERSONAL TELEMETRY & MOMENTUM HUD BAR                    */}
      {/* =================================================================== */}
      <div className="rounded-xl border border-zinc-800/90 bg-[#121215] px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-bold text-emerald-300">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            <span>Focus Cockpit</span>
            <span className="text-[10px] font-mono text-emerald-200/80 ml-0.5">
              ({rankedStream.length} in stream)
            </span>
          </div>

          {sessionStreak > 0 && (
            <div className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-xs font-bold text-amber-300">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span>{sessionStreak} Call Streak</span>
            </div>
          )}

          {/* Compact Live Metrics */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-lg bg-[#09090b] border border-zinc-800/90 px-2.5 py-1 text-zinc-400">
              Dials: <strong className="text-sky-300 font-mono">{telemetry.totalCallsDialed}</strong>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-zinc-800/90 px-2.5 py-1 text-zinc-400">
              Answered: <strong className="text-cyan-300 font-mono">{telemetry.answeredLeads}</strong>{" "}
              <span className="text-[10px] text-zinc-500">({telemetry.answerRatePct}%)</span>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-zinc-800/90 px-2.5 py-1 text-zinc-400">
              Owner Spoke: <strong className="text-indigo-300 font-mono">{telemetry.connectedLeads}</strong>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-emerald-500/30 px-2.5 py-1 text-zinc-300">
              Meetings: <strong className="text-emerald-400 font-mono">{telemetry.meetingsBooked}</strong>
            </span>
          </div>
        </div>

        {/* Built-in Drawers (Callbacks / Search & Personal Funnel / Timezones) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setActiveDrawer(activeDrawer === "LOOKUP" ? "NONE" : "LOOKUP")
            }
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              activeDrawer === "LOOKUP"
                ? "border-amber-400 bg-amber-500/15 text-amber-200"
                : mandatoryDueCount > 0
                ? "border-rose-500/50 bg-rose-500/15 text-rose-200 animate-pulse"
                : "border-zinc-800 bg-[#09090b] text-zinc-300 hover:text-white hover:border-zinc-700"
            }`}
          >
            <Search className="w-3.5 h-3.5 text-amber-400" />
            <span>Callbacks &amp; Search</span>
            {telemetry.followUpsScheduled > 0 && (
              <span className="rounded-full bg-amber-500/25 border border-amber-400/40 px-1.5 py-0.2 text-[10px] font-bold text-amber-200">
                {telemetry.followUpsScheduled}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveDrawer(activeDrawer === "ANALYTICS" ? "NONE" : "ANALYTICS")
            }
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              activeDrawer === "ANALYTICS"
                ? "border-emerald-400 bg-emerald-500/15 text-emerald-200"
                : "border-zinc-800 bg-[#09090b] text-zinc-300 hover:text-white hover:border-zinc-700"
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>My Funnel &amp; Best Hours</span>
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* 1.5 INLINE SLIDE-DOWN DRAWERS (ZERO PAGE SWITCHING FOR CALLERS)     */}
      {/* =================================================================== */}
      {activeDrawer === "LOOKUP" && (
        <div className="rounded-xl border border-amber-500/30 bg-[#121215] p-4 space-y-3 shadow-xl animate-in fade-in duration-150">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-white">
                Quick Lead Lookup &amp; Scheduled Callbacks
              </span>
              <div className="flex items-center gap-1 ml-2">
                {[
                  { id: "FOLLOW_UPS" as const, label: `Follow-Ups (${telemetry.followUpsScheduled})` },
                  { id: "MEETINGS" as const, label: `Meetings (${telemetry.meetingsBooked})` },
                  { id: "ALL" as const, label: `All Queue (${leads.length})` },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setLookupTab(t.id)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                      lookupTab === t.id
                        ? "bg-white text-black"
                        : "bg-zinc-900 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-56">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                  placeholder="Find company, owner, phone..."
                  className="w-full rounded-lg border border-zinc-800 bg-[#09090b] pl-8 pr-2.5 py-1 text-xs text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setActiveDrawer("NONE")}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {lookupLeads.length === 0 ? (
            <div className="py-6 text-center text-xs text-zinc-500">
              No matching leads found in this tab.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1">
              {lookupLeads.map((item) => {
                const fu = formatFollowUpLabel(item.nextFollowUp);
                const isCurrent = item.companyId === activeLead.companyId;
                return (
                  <button
                    key={item.companyId}
                    type="button"
                    onClick={() => {
                      setPinnedLeadId(item.companyId);
                      setActiveDrawer("NONE");
                    }}
                    className={`p-2.5 rounded-lg border text-left transition flex items-start justify-between gap-2 ${
                      isCurrent
                        ? "border-emerald-400 bg-emerald-500/10"
                        : "border-zinc-800 bg-[#09090b] hover:border-zinc-700"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {item.name}
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                        {item.bestContact.name || "Owner"} •{" "}
                        <span className="font-mono text-emerald-400">
                          {item.bestContact.phone || item.phone}
                        </span>
                      </div>
                      {fu.text && (
                        <div
                          className={`text-[10px] font-semibold mt-1 ${
                            fu.isOverdue ? "text-rose-400" : "text-amber-300"
                          }`}
                        >
                          {fu.isOverdue ? "Overdue: " : "Due: "}
                          {fu.text}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] font-semibold text-emerald-400 shrink-0">
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
        <div className="rounded-xl border border-emerald-500/30 bg-[#121215] p-4 space-y-4 shadow-xl animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-white">
                {activeActorName}&apos;s Live Conversion Funnel &amp; US Golden Calling Windows
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveDrawer("NONE")}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
            <div className="rounded-lg border border-zinc-800 bg-[#09090b] p-3">
              <span className="text-[10px] uppercase text-zinc-500 font-bold">Assigned Pool</span>
              <div className="text-xl font-bold text-white mt-0.5">{telemetry.totalLeads}</div>
              <span className="text-[10px] text-zinc-400">{telemetry.untouchedLeads} untouched left</span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-[#09090b] p-3">
              <span className="text-[10px] uppercase text-sky-400 font-bold">Total Dials</span>
              <div className="text-xl font-bold text-sky-300 mt-0.5">{telemetry.totalCallsDialed}</div>
              <span className="text-[10px] text-zinc-400">{telemetry.dialedLeads} unique leads</span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-[#09090b] p-3">
              <span className="text-[10px] uppercase text-cyan-400 font-bold">Human Pickup Rate</span>
              <div className="text-xl font-bold text-cyan-300 mt-0.5">{telemetry.answerRatePct}%</div>
              <span className="text-[10px] text-zinc-400">{telemetry.answeredLeads} answered</span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-[#09090b] p-3">
              <span className="text-[10px] uppercase text-indigo-400 font-bold">Owner Connect Rate</span>
              <div className="text-xl font-bold text-indigo-300 mt-0.5">{telemetry.connectRatePct}%</div>
              <span className="text-[10px] text-zinc-400">{telemetry.connectedLeads} decision makers</span>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
              <span className="text-[10px] uppercase text-emerald-400 font-bold">Meetings Booked</span>
              <div className="text-xl font-bold text-emerald-300 mt-0.5">{telemetry.meetingsBooked}</div>
              <span className="text-[10px] text-emerald-300/80">
                {telemetry.connectedLeads > 0
                  ? `${Math.round((telemetry.meetingsBooked / telemetry.connectedLeads) * 100)}% close on convos`
                  : "Ready to close"}
              </span>
            </div>
          </div>

          {/* Live US Timezone Radar */}
          <div className="rounded-lg border border-zinc-800 bg-[#09090b] p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-zinc-200 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
                <span>Live US Prospect Clocks (Auto-Prioritized by Queue Engine)</span>
              </span>
              <span className="text-zinc-500">Prime Windows: 8:45–11:30 AM &amp; 1:30–4:30 PM Local</span>
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
                    className={`rounded-lg border px-3 py-2 text-xs flex items-center justify-between ${
                      isPrime
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : isBypass
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                        : "border-zinc-800 bg-zinc-900/60 text-zinc-400"
                    }`}
                  >
                    <div>
                      <div className="font-bold">{tz.label} ({tz.id})</div>
                      <div className="text-[10px] opacity-80">
                        {isPrime ? "🟢 Prime Window" : isBypass ? "⚡ GK Bypass" : "Standard / Off-Peak"}
                      </div>
                    </div>
                    <div className="font-mono font-bold text-sm">
                      {h12}:{String(minute).padStart(2, "0")} {ampm}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* 2. MANDATORY FOLLOW-UP ENFORCEMENT LOCK BANNER                      */}
      {/* =================================================================== */}
      {activeRankedItem.isMandatoryFollowUpLock && (
        <div className="rounded-xl border-2 border-amber-500/70 bg-gradient-to-r from-amber-950/60 via-rose-950/40 to-[#121215] px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-300 shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-amber-300">
                  Mandatory Follow-Up Lock Active
                </span>
                <span className="rounded-full bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[10px] font-bold text-rose-200">
                  {activeRankedItem.reasonBadge}
                </span>
              </div>
              <p className="text-xs text-zinc-200 mt-0.5">
                Scheduled callback for <strong>{activeLead.name}</strong> ({dmName || "Owner"}) is due right now. Dial &amp; log this follow-up to unlock the rest of your queue.
              </p>
            </div>
          </div>

          {callHistory[0] && (
            <div className="rounded-lg bg-[#09090b]/90 border border-amber-500/30 px-3 py-1.5 text-[11px] text-zinc-300 max-w-md truncate">
              <span className="text-amber-300 font-semibold">Last Note: </span>
              <span>{callHistory[0].text}</span>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* 3. MAIN SPLIT FOCUS COCKPIT (LEFT: INTEL & SCRIPT | RIGHT: OUTCOME) */}
      {/* =================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* ----------------------------------------------------------------- */}
        {/* LEFT COLUMN (7 cols): LEAD INTELLIGENCE, DIALER & LIVE SCRIPT     */}
        {/* ----------------------------------------------------------------- */}
        <div className="lg:col-span-7 rounded-2xl border border-zinc-800/90 bg-[#121215] p-5 space-y-4 shadow-lg">
          {/* Top Queue Position & Prospect Local Time Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${
                  activeRankedItem.tier === "MANDATORY_FOLLOW_UP_DUE"
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                    : activeRankedItem.tier === "PRIME_WINDOW_FRESH"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200"
                }`}
              >
                <span>{activeRankedItem.reasonBadge}</span>
              </span>

              <span
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                  activeRankedItem.localTime.windowStatus === "PRIME_WINDOW"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : activeRankedItem.localTime.windowStatus === "GATEKEEPER_BYPASS"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    : "border-zinc-800 bg-[#09090b] text-zinc-400"
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>{activeRankedItem.localTime.windowLabel}</span>
              </span>
            </div>

            {/* Stream Navigation Controls (Locked if Mandatory Follow-Up) */}
            <div className="flex items-center gap-1.5">
              {pinnedLeadId && (
                <button
                  type="button"
                  onClick={() => setPinnedLeadId(null)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:text-white"
                >
                  Back to Auto-Stream
                </button>
              )}

              <button
                type="button"
                disabled={activeRankedItem.isMandatoryFollowUpLock || cursorIndex <= 0}
                onClick={() => setCursorIndex((c) => Math.max(0, c - 1))}
                className="p-1.5 rounded-lg border border-zinc-800 bg-[#09090b] text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
                title="Previous lead in stream"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[11px] font-mono text-zinc-400 px-1">
                #{pinnedLeadId ? "Pinned" : Math.min(cursorIndex + 1, rankedStream.length)} / {rankedStream.length}
              </span>
              <button
                type="button"
                disabled={
                  activeRankedItem.isMandatoryFollowUpLock ||
                  cursorIndex >= rankedStream.length - 1
                }
                onClick={() =>
                  setCursorIndex((c) => Math.min(rankedStream.length - 1, c + 1))
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-zinc-800 bg-[#09090b] text-xs font-medium text-zinc-300 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed transition"
                title={
                  activeRankedItem.isMandatoryFollowUpLock
                    ? "Queue locked: complete this due follow-up first"
                    : "Skip to next lead"
                }
              >
                <span>{activeRankedItem.isMandatoryFollowUpLock ? "Locked" : "Skip"}</span>
                {activeRankedItem.isMandatoryFollowUpLock ? (
                  <Lock className="w-3 h-3 text-amber-400" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Company Title + Quick Metadata Row */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                  {activeLead.name}
                </h2>
                <CallStatusBadge lead={activeLead} showAttempts showLastCalled />
                <span className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-xs font-bold text-emerald-400">
                  ICP {activeLead.icpScore}/100
                </span>
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
                  className="hover:text-white inline-flex items-center gap-1 transition"
                >
                  <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Maps</span>
                </a>

                {activeLead.website && (
                  <a
                    href={activeLead.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white inline-flex items-center gap-1 transition"
                  >
                    <span>
                      {activeLead.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                    </span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}

                {dmEmail && (
                  <a
                    href={`mailto:${dmEmail}`}
                    className="hover:text-white inline-flex items-center gap-1 transition"
                  >
                    <Mail className="w-3.5 h-3.5 text-zinc-500" />
                    <span>{dmEmail}</span>
                  </a>
                )}
              </div>
            </div>

            {canEditContacts && (
              <button
                type="button"
                onClick={() => onOpenEditLead(activeLead)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-[#09090b] hover:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white transition"
              >
                <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                <span>Edit Lead</span>
              </button>
            )}
          </div>

          {/* HERO DIALER & DECISION MAKER CARD */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-[#09090b] via-emerald-950/15 to-[#09090b] p-4 items-center">
            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400">
                Target Decision Maker
              </div>
              <div className="text-base font-bold text-white mt-0.5 flex items-center gap-2">
                <span>{dmName || "Owner / Managing Principal"}</span>
                {canEditContacts && (
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
              <div className="text-xs text-zinc-400">
                {dmTitle || "Primary Decision Maker"}
              </div>
            </div>

            <div className="flex flex-col sm:items-end gap-1.5">
              {dialPhone ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyText(dialPhone, `phone_${activeLead.companyId}`)}
                    className="inline-flex items-center gap-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold px-4 py-2.5 text-base font-mono transition shadow-md cursor-pointer"
                    title="Click or press Spacebar to copy phone number"
                  >
                    <Phone className="w-4 h-4 fill-black" />
                    <span>{dialPhone}</span>
                    {copiedKey === `phone_${activeLead.companyId}` ? (
                      <span className="rounded bg-black/20 px-1.5 py-0.5 text-[11px] font-sans font-bold">
                        Copied!
                      </span>
                    ) : (
                      <Copy className="w-4 h-4 opacity-75" />
                    )}
                  </button>

                  <a
                    href={`tel:${dialPhone.replace(/\D/g, "")}`}
                    className="inline-flex items-center justify-center p-2.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-emerald-400 transition"
                    title="Launch system softphone (tel:)"
                  >
                    <PhoneCall className="w-4 h-4" />
                  </a>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenEditLead(activeLead)}
                  className="text-xs font-semibold text-amber-300 underline"
                >
                  + Add Phone Number
                </button>
              )}
              <span className="text-[10px] text-zinc-500">
                Tip: Press <kbd className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono">Space</kbd> to copy number • Keys <kbd className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono">1</kbd>–<kbd className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono">7</kbd> to log outcome
              </span>
            </div>
          </div>

          {/* 3-BULLET FLASH BATTLECARD (SCANNABLE IN 2 SECONDS) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-rose-500/25 bg-rose-950/10 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                <Target className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>Why Call / Pain Trigger</span>
              </div>
              <p className="text-xs text-zinc-200 leading-snug">
                {battlecard.painTrigger}
              </p>
            </div>

            <div className="rounded-xl border border-sky-500/25 bg-sky-950/10 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-300">
                <Building2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>Scale &amp; Tech Stack</span>
              </div>
              <p className="text-xs text-zinc-200 leading-snug">
                {battlecard.scaleAndTech}
              </p>
            </div>

            <div className="rounded-xl border border-amber-500/25 bg-amber-950/10 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Gatekeeper Bypass</span>
              </div>
              <p className="text-xs text-zinc-200 leading-snug">
                {battlecard.gatekeeperTip}
              </p>
            </div>
          </div>

          {/* INTERACTIVE SCRIPT & LIVE OBJECTION SWITCHER */}
          <div className="rounded-xl border border-indigo-500/25 bg-indigo-950/10 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-500/20 pb-2.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-indigo-200">
                  Live Pitch &amp; Instant Objection Switcher
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {[
                  { key: "OPENING" as const, label: "🎙️ Opener" },
                  { key: "GATEKEEPER" as const, label: "🛡️ Gatekeeper" },
                  { key: "OBJ_BUSY" as const, label: "⏱️ 'I'm Busy'" },
                  { key: "OBJ_CURRENT_SYSTEM" as const, label: "🤝 'Have CRM'" },
                  { key: "OBJ_SEND_EMAIL" as const, label: "📧 'Send Email'" },
                  { key: "OBJ_PRICE" as const, label: "💰 'Price?'" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveScriptTab(tab.key)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                      activeScriptTab === tab.key
                        ? "bg-indigo-500 text-white shadow-sm"
                        : "bg-[#09090b]/80 text-indigo-200/80 hover:text-white border border-indigo-500/20"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#09090b]/90 border border-indigo-500/20 text-indigo-100 text-sm leading-relaxed font-sans select-text">
              {battlecard.scripts[activeScriptTab]}
            </div>
          </div>

          {/* COMPACT CALL LOG TIMELINE */}
          {callHistory.length > 0 && (
            <div className="rounded-xl border border-zinc-800/80 bg-[#09090b]/80 p-3.5 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                <span>Previous Call History ({callHistory.length} attempts)</span>
                {activeLead.nextFollowUp && (
                  <span className="text-amber-300 font-semibold">
                    Follow-Up: {formatFollowUpLabel(activeLead.nextFollowUp).text}
                  </span>
                )}
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {callHistory.slice(0, 5).map((entry, idx) => {
                  const def = CALL_STATUS_DEFS[entry.outcome];
                  return (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-2 text-xs p-2 rounded-lg bg-[#121215] border border-zinc-800/70"
                    >
                      <div className="min-w-0">
                        <span className={`inline-block rounded px-1.5 py-0.2 text-[10px] font-bold mr-2 border ${def.badge}`}>
                          {def.label}
                        </span>
                        <span className="text-zinc-200">{entry.text}</span>
                      </div>
                      <span className="text-[10px] text-zinc-500 shrink-0 font-mono">
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
        {/* RIGHT COLUMN (5 cols): ZERO-MODAL 1-TAP OUTCOME & AUTO-ADVANCE    */}
        {/* ----------------------------------------------------------------- */}
        <div className="lg:col-span-5 rounded-2xl border border-zinc-800/90 bg-[#121215] p-5 space-y-4 shadow-lg sticky top-4">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white">
                Instant Call Outcome Console
              </h3>
              <p className="text-[11px] text-zinc-400">
                Tap outcome or press <kbd className="font-mono text-zinc-300">1–7</kbd> • Auto-loads next lead
              </p>
            </div>

            <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none bg-[#09090b] border border-zinc-800 px-2.5 py-1 rounded-lg">
              <input
                type="checkbox"
                checked={oneTapAutoAdvance}
                onChange={(e) => setOneTapAutoAdvance(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
              />
              <span>1-Tap Fast Advance (NA/VM)</span>
            </label>
          </div>

          {/* 7 DISPOSITION BUTTONS */}
          <div className="grid grid-cols-2 gap-2">
            {DISPOSITION_BUTTONS.map((btn) => {
              const isSelected = selectedOutcome === btn.key;
              return (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => handleSelectDisposition(btn)}
                  className={`p-3 rounded-xl border text-left transition flex flex-col justify-between gap-1 ${
                    btn.key === "MEETING_BOOKED" ? "col-span-2" : ""
                  } ${isSelected ? btn.activeClass : btn.accentClass}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold">{btn.label}</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-black/50 border border-white/10 text-[10px] font-mono opacity-80">
                      {btn.hotkey}
                    </kbd>
                  </div>
                  <span className="text-[10px] opacity-75">{btn.sublabel}</span>
                </button>
              );
            })}
          </div>

          {/* 1-TAP SMART NOTE CHIPS (ZERO TYPING REQUIRED) */}
          {selectedOutcome && quickChips.length > 0 && (
            <div className="space-y-1.5 animate-in fade-in duration-150">
              <div className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3 text-emerald-400" />
                <span>1-Tap Quick Notes (Click to insert):</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
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
                            ? `${prev.trim()} • ${chip}`
                            : chip
                        );
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                        isUsed
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                          : "border-zinc-800 bg-[#09090b] text-zinc-300 hover:border-zinc-600 hover:text-white"
                      }`}
                    >
                      + {chip}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* MANDATORY / SMART FOLLOW-UP SCHEDULER */}
          {selectedOutcome &&
            selectedOutcome !== "NOT_INTERESTED" &&
            selectedOutcome !== "WRONG_NUMBER" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-3 space-y-2 animate-in fade-in duration-150">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-[11px] font-bold text-amber-200 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-amber-400" />
                    <span>
                      {selectedOutcome === "CONNECTED"
                        ? "Mandatory Follow-Up Lock"
                        : "Next Follow-Up / Retry"}
                    </span>
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {[
                      { label: "In 3 Hrs", preset: "LATER_TODAY" as const },
                      { label: "Tomorrow 10am", preset: "TOMORROW" as const },
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
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold border transition ${
                          followUpPresetUsed === p.preset
                            ? "bg-amber-400 text-black border-amber-300"
                            : "border-zinc-800 bg-[#09090b] text-amber-300 hover:bg-zinc-900"
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
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>
            )}

          {/* PROGRESSIVE DISCLOSURE: QUALIFICATION FIELDS ONLY WHEN CONNECTED / BOOKED */}
          {showQualificationFields && smartFields.length > 0 && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/10 p-3 space-y-2 animate-in fade-in duration-150">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                Qualification Discovery (Unlocked on Live Connection)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {smartFields.slice(0, 4).map((field) => {
                  const val = resolveSmartFieldValue(activeLead, field);
                  const opts = field.options.includes(val)
                    ? field.options
                    : [val, ...field.options];
                  return (
                    <div key={field.key} className="space-y-0.5">
                      <label className="block text-[10px] text-zinc-400 truncate">
                        {field.shortLabel}
                      </label>
                      <select
                        value={val}
                        onChange={(e) =>
                          onSmartFieldChange(activeLead, field, e.target.value)
                        }
                        className="w-full rounded-lg border border-zinc-800 bg-[#09090b] px-2 py-1 text-xs font-semibold text-white focus:outline-none focus:border-emerald-400"
                      >
                        {opts.map((o) => (
                          <option key={o} value={o} className="bg-[#121215]">
                            {o}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* OPTIONAL CALL NOTES INPUT */}
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-zinc-400">
              Call Note (Optional — or tap chips above)
            </label>
            <textarea
              rows={2}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Quick note (e.g., spoke to Mike, asked to call Thursday morning)..."
              className="w-full rounded-xl border border-zinc-800 bg-[#09090b] px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none resize-none"
            />
          </div>

          {validationHint && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
              {validationHint}
            </div>
          )}

          {/* SAVE & AUTO-LOAD NEXT LEAD BUTTON */}
          <button
            type="button"
            disabled={!selectedOutcome}
            onClick={() => {
              if (!selectedOutcome) {
                setValidationHint("Select a call outcome above (1–7) first.");
                return;
              }
              commitDisposition(selectedOutcome);
            }}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white hover:bg-zinc-200 disabled:opacity-35 disabled:cursor-not-allowed text-black font-extrabold py-3 px-4 text-xs transition shadow-md cursor-pointer"
          >
            <PhoneCall className="w-4 h-4" />
            <span>
              {selectedOutcome
                ? `Log "${CALL_STATUS_DEFS[selectedOutcome].label}" & Next Lead →`
                : "Select Outcome (1–7) to Advance"}
            </span>
          </button>

          {/* UP NEXT IN STREAM PREVIEW (SPOTIFY QUEUE BUFFER) */}
          {nextUpLeads.length > 0 && (
            <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Up Next in Pre-Buffered Stream
              </div>
              {nextUpLeads.map((item) => (
                <div
                  key={item.lead.companyId}
                  className="flex items-center justify-between gap-2 rounded-lg bg-[#09090b] border border-zinc-800/70 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-zinc-200 truncate">
                      {item.lead.name}
                    </div>
                    <div className="text-[10px] text-zinc-500 truncate">
                      {item.lead.bestContact.name || "Owner"} • {item.localTime.localTimeFormatted}
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-emerald-400/90 shrink-0">
                    {item.lead.icpScore}/100
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
