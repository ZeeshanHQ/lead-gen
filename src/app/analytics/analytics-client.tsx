"use client";

import React, { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import type { LeadRow } from "@/server/repo/queue";
import type { TeamMember } from "@/server/domain/team";
import {
  CALL_STATUS_DEFS,
  type CallOutcomeKey,
  type CallStatusKey,
} from "@/server/domain/call-outcomes";
import {
  CALLER_TIMEZONE,
  CALLER_TZ_LABEL,
  US_TZ_GROUPS,
  formatClock,
  formatHour12,
  wallClock,
} from "@/server/domain/call-time";
import {
  buildCallEvents,
  computeFunnel,
  type AuditCallInput,
  type FunnelFilters,
  type FunnelLead,
  type FunnelMember,
  type FunnelResult,
  type Timeframe,
} from "@/server/domain/funnel-analytics";
import { CallStatusBadge, CallStatusLegend } from "@/components/call-status-ui";
import {
  TrendingUp,
  PhoneCall,
  PhoneForwarded,
  ShieldAlert,
  CalendarCheck,
  Clock,
  ArrowRight,
  Users,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  ExternalLink,
  Target,
  BarChart3,
  Award,
  ChevronRight,
  Filter,
  Zap,
  Flame,
  Layers,
  PieChart,
  Activity,
  ShieldCheck,
  Sparkles,
  HelpCircle,
  PhoneOff,
  Globe,
  Calendar,
  ArrowUpRight,
  Info,
} from "lucide-react";

export interface CallAuditEntry {
  id: string;
  actor: string;
  companyId?: string | null;
  callOutcome: string;
  notes?: string;
  createdAt: string;
  painIdentified?: boolean;
}

interface SalesFunnelClientProps {
  leads: LeadRow[];
  teamCallers: TeamMember[];
  callEvents?: CallAuditEntry[];
  marketName: string;
  tenantName: string;
  isOwner: boolean;
  activeMemberName?: string;
}

type FunnelViewMode = "CIRCULAR" | "STEPPED" | "BOTH";
type AnalyticsTab = "OVERVIEW" | "HOURLY" | "CALLERS" | "ICP_QUALITY" | "TRENDS";

// ---------------------------------------------------------------------------
// SVG Circular Gauge Component
// ---------------------------------------------------------------------------

function CircularGauge({
  value,
  size = 120,
  strokeWidth = 10,
  color = "#10b981",
  bgColor = "#27272a",
  label,
  sublabel,
  countText,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
  label: string;
  sublabel?: string;
  countText?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const validValue = Math.min(100, Math.max(0, isNaN(value) ? 0 : value));
  const strokeDashoffset = circumference - (validValue / 100) * circumference;

  return (
    <div className="flex flex-col items-center text-center p-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={bgColor}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-black font-mono text-white tracking-tight">
            {validValue}%
          </span>
          {countText && (
            <span className="text-[10px] font-medium text-zinc-400 mt-0.5">
              {countText}
            </span>
          )}
        </div>
      </div>
      <span className="text-xs font-bold text-zinc-200 mt-2.5">{label}</span>
      {sublabel && <span className="text-[10px] text-zinc-400 mt-0.5">{sublabel}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG Outcome Donut Chart Component
// ---------------------------------------------------------------------------

function OutcomeDonutChart({
  outcomeCounts,
  totalDials,
}: {
  outcomeCounts: Record<CallOutcomeKey, number>;
  totalDials: number;
}) {
  const size = 160;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const segments: Array<{
    key: CallOutcomeKey;
    label: string;
    count: number;
    color: string;
    dotClass: string;
  }> = [
    {
      key: "MEETING_BOOKED",
      label: CALL_STATUS_DEFS.MEETING_BOOKED.label,
      count: outcomeCounts.MEETING_BOOKED || 0,
      color: "#10b981", // emerald
      dotClass: "bg-emerald-400",
    },
    {
      key: "CONNECTED",
      label: CALL_STATUS_DEFS.CONNECTED.label,
      count: outcomeCounts.CONNECTED || 0,
      color: "#6366f1", // indigo
      dotClass: "bg-indigo-400",
    },
    {
      key: "GATEKEEPER_BLOCKED",
      label: CALL_STATUS_DEFS.GATEKEEPER_BLOCKED.label,
      count: outcomeCounts.GATEKEEPER_BLOCKED || 0,
      color: "#f97316", // orange
      dotClass: "bg-orange-400",
    },
    {
      key: "NO_ANSWER",
      label: CALL_STATUS_DEFS.NO_ANSWER.label,
      count: outcomeCounts.NO_ANSWER || 0,
      color: "#f59e0b", // amber
      dotClass: "bg-amber-400",
    },
    {
      key: "CALL_COMPLETED",
      label: CALL_STATUS_DEFS.CALL_COMPLETED.label,
      count: outcomeCounts.CALL_COMPLETED || 0,
      color: "#0ea5e9", // sky
      dotClass: "bg-sky-400",
    },
    {
      key: "WRONG_NUMBER",
      label: CALL_STATUS_DEFS.WRONG_NUMBER.label,
      count: outcomeCounts.WRONG_NUMBER || 0,
      color: "#f43f5e", // rose
      dotClass: "bg-rose-400",
    },
    {
      key: "NOT_INTERESTED",
      label: CALL_STATUS_DEFS.NOT_INTERESTED.label,
      count: outcomeCounts.NOT_INTERESTED || 0,
      color: "#71717a", // zinc
      dotClass: "bg-zinc-400",
    },
  ];

  let accumulatedPercent = 0;

  return (
    <div className="flex flex-col lg:flex-row items-center gap-6 p-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#27272a"
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          {totalDials > 0 &&
            segments.map((seg) => {
              if (seg.count <= 0) return null;
              const percent = seg.count / totalDials;
              const strokeDasharray = `${circumference * percent} ${circumference * (1 - percent)}`;
              const strokeDashoffset = -circumference * accumulatedPercent;
              accumulatedPercent += percent;
              return (
                <circle
                  key={seg.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke={seg.color}
                  strokeWidth={strokeWidth}
                  fill="transparent"
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-500 hover:opacity-80"
                />
              );
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-black font-mono text-white">{totalDials}</span>
          <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
            Total Dials
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs w-full">
        {segments.map((item) => {
          const pct = totalDials > 0 ? Math.round((item.count / totalDials) * 100) : 0;
          return (
            <div
              key={item.key}
              className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80"
            >
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${item.dotClass}`} />
                <span className="text-zinc-300 font-medium">{item.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-white">{item.count}</span>
                <span className="text-[10px] text-zinc-400 font-mono">({pct}%)</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function SalesFunnelClient({
  leads,
  teamCallers,
  callEvents = [],
  marketName,
  tenantName,
  isOwner,
  activeMemberName,
}: SalesFunnelClientProps) {
  const [selectedCallerId, setSelectedCallerId] = useState<string>("ALL");
  const [timeframe, setTimeframe] = useState<Timeframe>("ALL");
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("OVERVIEW");
  const [viewMode, setViewMode] = useState<FunnelViewMode>("BOTH");
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [hourlyTzMode, setHourlyTzMode] = useState<"PROSPECT" | "CALLER">("PROSPECT");
  const [showLegendMeaning, setShowLegendMeaning] = useState<boolean>(false);

  // Live Clock Tick (every 10 seconds)
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  // 1. Adapt leads to pure domain FunnelLead[]
  const funnelLeads: FunnelLead[] = useMemo(() => {
    return leads.map((l) => ({
      id: l.id,
      name: l.name,
      state: l.state,
      status: l.status,
      notes: l.notes,
      icpScore: l.icpScore,
      assignedMemberId: l.assignedMemberId || null,
      createdAtMs: l.createdAt ? new Date(l.createdAt).getTime() : null,
    }));
  }, [leads]);

  // 2. Adapt raw audit logs to domain AuditCallInput[]
  const auditInputs: AuditCallInput[] = useMemo(() => {
    return callEvents.map((evt) => ({
      id: evt.id,
      actor: evt.actor,
      companyId: evt.companyId || null,
      callOutcome: evt.callOutcome,
      notes: evt.notes || "",
      createdAtMs: new Date(evt.createdAt).getTime(),
    }));
  }, [callEvents]);

  // 3. Adapt callers to domain FunnelMember[]
  const funnelMembers: FunnelMember[] = useMemo(() => {
    return teamCallers.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      title: m.title || "Sales Caller",
    }));
  }, [teamCallers]);

  // 4. Build deduplicated call events
  const rawEvents = useMemo(() => {
    return buildCallEvents(funnelLeads, auditInputs, funnelMembers, nowMs);
  }, [funnelLeads, auditInputs, funnelMembers, nowMs]);

  // 5. Pure Funnel Computation
  const funnelResult: FunnelResult = useMemo(() => {
    const filters: FunnelFilters = {
      scope: selectedCallerId,
      timeframe,
      nowMs,
    };
    return computeFunnel(funnelLeads, rawEvents, funnelMembers, filters);
  }, [funnelLeads, rawEvents, funnelMembers, selectedCallerId, timeframe, nowMs]);

  // Lead Penetration Rate: dialed leads / total pool
  const poolPenetrationRate =
    funnelResult.pool > 0
      ? Math.round((funnelResult.dial.dialedLeads / funnelResult.pool) * 100)
      : 0;

  // Gatekeeper bypass calculation
  const stage1Count = funnelResult.stages[1]?.count ?? 0;
  const stage2Count = funnelResult.stages[2]?.count ?? 0;
  const stage3Count = funnelResult.stages[3]?.count ?? 0;

  const gatekeeperBypassRate =
    stage1Count > 0 && stage2Count > 0
      ? Math.round((stage2Count / stage1Count) * 100)
      : funnelResult.dial.human > 0
      ? Math.round((funnelResult.dial.owner / funnelResult.dial.human) * 100)
      : 0;

  // Decision maker discovery depth
  const discoveryDepthRate =
    stage2Count > 0 && stage3Count > 0
      ? Math.round((stage3Count / stage2Count) * 100)
      : 0;

  // Closing efficiency
  const closingRate = funnelResult.dial.closeRate;

  // Determine top bottleneck for AI diagnosis banner
  const primaryLeak = useMemo(() => {
    const untouched = funnelResult.pool - funnelResult.dial.dialedLeads;
    const noAnswer = funnelResult.outcomeCounts.NO_ANSWER || 0;
    const gatekeeper = funnelResult.outcomeCounts.GATEKEEPER_BLOCKED || 0;
    const notInterested = funnelResult.outcomeCounts.NOT_INTERESTED || 0;

    const leaks = [
      {
        type: "UNTOUCHED",
        count: untouched,
        rate: funnelResult.pool > 0 ? Math.round((untouched / funnelResult.pool) * 100) : 0,
        title: "Untouched Leads Pool",
        explanation: `${untouched} verified leads (${Math.round(
          (untouched / funnelResult.pool) * 100
        )}%) have not received a single call yet. Dialing capacity is your highest leverage bottleneck.`,
        actionLabel: "Open Untouched Leads in CRM",
        filterUrl: "/caller?status=UNTOUCHED",
        severity: untouched > 50 ? ("high" as const) : ("medium" as const),
      },
      {
        type: "NO_ANSWER",
        count: noAnswer,
        rate:
          funnelResult.dial.total > 0
            ? Math.round((noAnswer / funnelResult.dial.total) * 100)
            : 0,
        title: "High No-Answer Ring Out",
        explanation: `${noAnswer} calls (${Math.round(
          (noAnswer / Math.max(1, funnelResult.dial.total)) * 100
        )}%) rang out without an answer. Synchronize your calling blocks with prospect Golden Windows (8:30–10:00 AM local).`,
        actionLabel: "Open No-Answer Retries in CRM",
        filterUrl: "/caller?status=NO_ANSWER",
        severity: noAnswer > 25 ? ("high" as const) : ("medium" as const),
      },
      {
        type: "GATEKEEPER",
        count: gatekeeper,
        rate:
          funnelResult.dial.total > 0
            ? Math.round((gatekeeper / funnelResult.dial.total) * 100)
            : 0,
        title: "Front Desk & Gatekeeper Blocks",
        explanation: `${gatekeeper} dials were stopped at the front desk. Use authority-framed executive transfers: "Hi, I'm calling for [Owner First Name], is he in?"`,
        actionLabel: "Review Gatekeeper Leads in CRM",
        filterUrl: "/caller?status=GATEKEEPER_BLOCKED",
        severity: gatekeeper > 15 ? ("high" as const) : ("medium" as const),
      },
      {
        type: "NOT_INTERESTED",
        count: notInterested,
        rate:
          funnelResult.dial.owner > 0
            ? Math.round((notInterested / funnelResult.dial.owner) * 100)
            : 0,
        title: "Objections During Discovery",
        explanation: `${notInterested} decision-maker conversations ended in not interested. Focus opening pitch on direct pain points and quick 15-minute value rather than a hard pitch.`,
        actionLabel: "Review Objection Leads in CRM",
        filterUrl: "/caller?status=NOT_INTERESTED",
        severity: notInterested > 5 ? ("high" as const) : ("medium" as const),
      },
    ];

    leaks.sort((a, b) => b.count - a.count);
    return leaks[0];
  }, [funnelResult]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-20">
      {/* ------------------------------------------------------------------- */}
      {/* HEADER & TIMEZONE-SYNCED LIVE CLOCKS                               */}
      {/* ------------------------------------------------------------------- */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 font-bold">
                Real-Time Sales Telemetry
              </span>
              <span className="text-zinc-600">•</span>
              <span className="text-xs text-zinc-400 font-semibold">{marketName}</span>
              <span className="text-zinc-600">•</span>
              <span className="text-xs text-zinc-400">{tenantName}</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight mt-1">
              Sales Pipeline &amp; Conversion Funnel
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              Single-source telemetry derived directly from logged call outcomes. Track bottlenecks,
              golden calling hours, and close-rate velocity.
            </p>
          </div>

          {/* Timeframe & Scope Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Caller Selector */}
            <div className="flex items-center gap-1.5 bg-[#09090c] border border-zinc-800 rounded-lg px-2.5 py-1.5">
              <Users className="w-3.5 h-3.5 text-zinc-400" />
              <select
                value={selectedCallerId}
                onChange={(e) => setSelectedCallerId(e.target.value)}
                className="bg-transparent text-xs text-zinc-200 font-semibold focus:outline-none cursor-pointer"
              >
                <option value="ALL" className="bg-[#101014] text-zinc-200">
                  All Callers ({teamCallers.length})
                </option>
                <option value="UNASSIGNED" className="bg-[#101014] text-zinc-200">
                  Unassigned Leads
                </option>
                {teamCallers.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[#101014] text-zinc-200">
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Timeframe Selector */}
            <div className="flex items-center rounded-lg bg-[#09090c] border border-zinc-800 p-0.5">
              {(
                [
                  { id: "ALL", label: "All Time" },
                  { id: "TODAY", label: "Today" },
                  { id: "YESTERDAY", label: "Yesterday" },
                  { id: "LAST_7_DAYS", label: "7 Days" },
                  { id: "LAST_30_DAYS", label: "30 Days" },
                ] as const
              ).map((tf) => (
                <button
                  key={tf.id}
                  type="button"
                  onClick={() => setTimeframe(tf.id)}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
                    timeframe === tf.id
                      ? "bg-zinc-800 text-white shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live Synchronized Clocks Bar (PKT vs US Territories) */}
        <div className="pt-3 border-t border-zinc-800/80 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs">
          {/* Pakistan Caller Shift Clock */}
          <div className="p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                <span>🇵🇰</span>
                <span>Caller Base ({CALLER_TZ_LABEL})</span>
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </div>
            <div className="text-base font-black font-mono text-white mt-1">
              {formatClock(nowMs, CALLER_TIMEZONE)}
            </div>
            <div className="text-[10px] text-emerald-400/80 mt-0.5">Karachi / Lahore Shift</div>
          </div>

          {/* US Eastern (ET) */}
          {US_TZ_GROUPS.slice(0, 4).map((grp) => {
            const clock = formatClock(nowMs, grp.iana);
            const { hour } = wallClock(nowMs, grp.iana);
            const isOpen = hour >= 9 && hour < 17;
            const isGolden = (hour >= 8 && hour < 10) || (hour >= 16 && hour < 18);

            return (
              <div
                key={grp.id}
                className={`p-2.5 rounded-xl border flex flex-col justify-between ${
                  isGolden
                    ? "border-amber-500/40 bg-amber-950/20"
                    : isOpen
                    ? "border-sky-500/30 bg-sky-950/15"
                    : "border-zinc-800 bg-[#09090c]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    US {grp.label} ({grp.id})
                  </span>
                  {isGolden ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Golden Window
                    </span>
                  ) : isOpen ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300">
                      Open (9–5)
                    </span>
                  ) : (
                    <span className="text-[9px] text-zinc-500">Off-Hours</span>
                  )}
                </div>
                <div className="text-base font-black font-mono text-white mt-1">{clock}</div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  {isGolden
                    ? "Peak pick-up probability"
                    : isOpen
                    ? "Standard business hours"
                    : "Closed / Desk unstaffed"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* UNIFIED COLOR LEGEND (Single Source of Truth)                       */}
      {/* ------------------------------------------------------------------- */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Unified Call Status &amp; Funnel Legend
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowLegendMeaning((prev) => !prev)}
            className="text-[11px] font-semibold text-zinc-400 hover:text-white flex items-center gap-1 transition"
          >
            <HelpCircle className="w-3 h-3 text-zinc-400" />
            <span>{showLegendMeaning ? "Hide Guidance" : "Show When To Use"}</span>
          </button>
        </div>
        <CallStatusLegend showMeaning={showLegendMeaning} />
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* CORE KPI METRIC CARDS                                              */}
      {/* ------------------------------------------------------------------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Metric 1: Total Leads in Pool */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-[#101014]">
          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-zinc-400" />
            <span>Lead Pool</span>
          </div>
          <div className="text-2xl font-black font-mono text-white mt-1">
            {funnelResult.pool}
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5">
            <span className="text-emerald-400 font-bold">{poolPenetrationRate}%</span> dialed (
            {funnelResult.dial.dialedLeads} leads)
          </div>
        </div>

        {/* Metric 2: Total Dials Logged */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-[#101014]">
          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <PhoneCall className="w-3.5 h-3.5 text-sky-400" />
            <span>Total Dials</span>
          </div>
          <div className="text-2xl font-black font-mono text-white mt-1">
            {funnelResult.dial.total}
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5">
            avg {funnelResult.dial.avgAttempts} attempts / lead
          </div>
        </div>

        {/* Metric 3: Pick Rate */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-[#101014]">
          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <PhoneForwarded className="w-3.5 h-3.5 text-indigo-400" />
            <span>Pick Rate</span>
          </div>
          <div className="text-2xl font-black font-mono text-indigo-400 mt-1">
            {funnelResult.dial.pickRate}%
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5">
            {funnelResult.dial.human} answered calls
          </div>
        </div>

        {/* Metric 4: Gatekeeper Bypass */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-[#101014]">
          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-orange-400" />
            <span>GK Bypass Rate</span>
          </div>
          <div className="text-2xl font-black font-mono text-orange-400 mt-1">
            {gatekeeperBypassRate}%
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5">
            {funnelResult.dial.owner} reached decision makers
          </div>
        </div>

        {/* Metric 5: Meetings Booked */}
        <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-950/20">
          <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-bold">
            <CalendarCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Meetings Booked</span>
          </div>
          <div className="text-2xl font-black font-mono text-emerald-400 mt-1">
            {funnelResult.dial.meetings}
          </div>
          <div className="text-[11px] text-emerald-300 mt-0.5 font-semibold">
            {funnelResult.dial.dialsPerMeeting > 0
              ? `1 per ${funnelResult.dial.dialsPerMeeting} dials`
              : "0 booked in timeframe"}
          </div>
        </div>

        {/* Metric 6: Overdue Follow-ups Alert */}
        <div
          className={`p-4 rounded-xl border ${
            funnelResult.followUps.overdue > 0
              ? "border-rose-500/40 bg-rose-950/20"
              : "border-zinc-800 bg-[#101014]"
          }`}
        >
          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Active Follow-Ups</span>
          </div>
          <div
            className={`text-2xl font-black font-mono mt-1 ${
              funnelResult.followUps.overdue > 0 ? "text-rose-400" : "text-white"
            }`}
          >
            {funnelResult.followUps.scheduled}
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5">
            {funnelResult.followUps.overdue > 0 ? (
              <span className="text-rose-400 font-bold">
                ⚠️ {funnelResult.followUps.overdue} Overdue
              </span>
            ) : (
              <span className="text-zinc-500">All follow-ups current</span>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* BOTTLENECK & CRITICAL LEAK AI DIAGNOSIS BANNER                     */}
      {/* ------------------------------------------------------------------- */}
      {primaryLeak && primaryLeak.count > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-950/25 via-[#101014] to-zinc-900/60 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded">
                  Primary Funnel Leak Detected
                </span>
                <span className="text-xs font-bold text-white">{primaryLeak.title}</span>
              </div>
              <p className="text-xs text-zinc-300 mt-1.5 max-w-2xl leading-relaxed">
                {primaryLeak.explanation}
              </p>
            </div>
          </div>

          <div className="shrink-0">
            <Link
              href={primaryLeak.filterUrl}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition shadow-sm"
            >
              <span>{primaryLeak.actionLabel}</span>
              <ArrowRight className="w-3.5 h-3.5 text-black" />
            </Link>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* NAVIGATION TABS                                                     */}
      {/* ------------------------------------------------------------------- */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-2 overflow-x-auto">
          {[
            { id: "OVERVIEW", label: "Conversion Funnel & Gauges", icon: Target },
            { id: "HOURLY", label: "Peak Calling Hours (PKT Synced)", icon: Clock },
            { id: "CALLERS", label: "Caller Performance Leaderboard", icon: Users },
            { id: "ICP_QUALITY", label: "Lead Quality Tier Correlation", icon: Award },
            { id: "TRENDS", label: "Daily Conversion Trend", icon: TrendingUp },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id as AnalyticsTab)}
                className={`flex items-center gap-2 py-2 px-3.5 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                  active
                    ? "bg-zinc-800 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? "text-emerald-400" : "text-zinc-500"}`} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* View Mode Switcher for Main Funnel */}
        {activeTab === "OVERVIEW" && (
          <div className="hidden sm:flex items-center gap-1 bg-[#09090c] border border-zinc-800 rounded-lg p-0.5 text-xs">
            {(
              [
                { id: "CIRCULAR", label: "Circular" },
                { id: "STEPPED", label: "Stepped" },
                { id: "BOTH", label: "Both" },
              ] as const
            ).map((vm) => (
              <button
                key={vm.id}
                type="button"
                onClick={() => setViewMode(vm.id)}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition ${
                  viewMode === vm.id
                    ? "bg-zinc-800 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {vm.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* TAB 1: CONVERSION FUNNEL & GAUGES                                  */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "OVERVIEW" && (
        <div className="space-y-6">
          {/* SECTION A: CIRCULAR TELEMETRY GAUGES */}
          {(viewMode === "CIRCULAR" || viewMode === "BOTH") && (
            <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <span>Circular Conversion Gauges</span>
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Step-by-step conversion efficiency rings tracking stage transitions through the funnel.
                  </p>
                </div>
              </div>

              {/* 5 Circular Ring Gauges */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-2 bg-[#09090c] rounded-2xl border border-zinc-800/80">
                <CircularGauge
                  value={poolPenetrationRate}
                  color="#a1a1aa" // zinc
                  label="1. Pool Coverage"
                  sublabel="Leads with ≥1 dial"
                  countText={`${funnelResult.dial.dialedLeads} / ${funnelResult.pool}`}
                />
                <CircularGauge
                  value={funnelResult.dial.pickRate}
                  color="#6366f1" // indigo
                  label="2. Pick Rate"
                  sublabel="Answered / Total dials"
                  countText={`${funnelResult.dial.human} / ${funnelResult.dial.total}`}
                />
                <CircularGauge
                  value={gatekeeperBypassRate}
                  color="#f97316" // orange
                  label="3. Gatekeeper Bypass"
                  sublabel="Reached Decision Maker"
                  countText={`${funnelResult.dial.owner} / ${Math.max(1, funnelResult.dial.human)}`}
                />
                <CircularGauge
                  value={discoveryDepthRate}
                  color="#38bdf8" // sky
                  label="4. Discovery Depth"
                  sublabel="Live 2-way conversation"
                  countText={`${funnelResult.stages[3]?.count || 0} / ${Math.max(
                    1,
                    funnelResult.stages[2]?.count || 1
                  )}`}
                />
                <CircularGauge
                  value={closingRate}
                  color="#10b981" // emerald
                  label="5. Meeting Close Rate"
                  sublabel="Booked from Discovery"
                  countText={`${funnelResult.dial.meetings} / ${Math.max(
                    1,
                    funnelResult.stages[3]?.count || 1
                  )}`}
                />
              </div>

              {/* Donut Distribution Breakdown */}
              <div className="pt-4 border-t border-zinc-800/80">
                <div className="flex items-center gap-2 mb-2">
                  <PieChart className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Dial Outcome Distribution Matrix
                  </span>
                </div>
                <OutcomeDonutChart
                  outcomeCounts={funnelResult.outcomeCounts}
                  totalDials={funnelResult.dial.total}
                />
              </div>
            </div>
          )}

          {/* SECTION B: STEPPED FUNNEL WITH LEAK CARDS & CRM DEEP LINKS */}
          {(viewMode === "STEPPED" || viewMode === "BOTH") && (
            <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-indigo-400" />
                    <span>5-Stage Sales Funnel Flow &amp; Leak Analysis</span>
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Click any leak button to filter those exact leads directly in the CRM workbench.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {funnelResult.stages.map((stage, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === funnelResult.stages.length - 1;

                  return (
                    <div
                      key={stage.id}
                      className="rounded-xl border border-zinc-800 bg-[#09090c] p-4 space-y-3 transition hover:border-zinc-700"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span
                            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold"
                            style={{
                              backgroundColor: `${stage.hex}25`,
                              color: stage.hex,
                              border: `1px solid ${stage.hex}50`,
                            }}
                          >
                            {idx + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-white">{stage.label}</span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                                {stage.count} leads ({stage.pctOfPool}%)
                              </span>
                            </div>
                            <p className="text-[11px] text-zinc-400">{stage.description}</p>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-sm font-black font-mono" style={{ color: stage.hex }}>
                            {isFirst ? "100%" : `${stage.stepPct}% Transition`}
                          </div>
                          {!isFirst && (
                            <div className="text-[10px] text-zinc-500">from previous stage</div>
                          )}
                        </div>
                      </div>

                      {/* Visual Stepped Bar */}
                      <div className="w-full h-3 rounded-full bg-zinc-900 border border-zinc-800 overflow-hidden flex">
                        <div
                          className="h-full transition-all duration-700"
                          style={{
                            width: `${Math.max(3, stage.pctOfPool)}%`,
                            backgroundColor: stage.hex,
                          }}
                        />
                      </div>

                      {/* Leaks & CRM Deep-Link Badges */}
                      {stage.leaks && stage.leaks.length > 0 && (
                        <div className="pt-2 border-t border-zinc-900 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] uppercase font-bold text-zinc-500">
                              Drop-Off Leaks:
                            </span>
                            {stage.leaks.map((leak) => {
                              const leakDef = CALL_STATUS_DEFS[leak.colorKey];
                              return (
                                <Link
                                  key={leak.key}
                                  href={`/caller?status=${leak.crmFilter || "ALL"}`}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-800 bg-[#101014] hover:bg-zinc-800 text-xs text-zinc-300 transition group"
                                  title={`Filter ${leak.count} leads with "${leak.label}" in CRM`}
                                >
                                  <span className={`h-2 w-2 rounded-full ${leakDef.dot}`} />
                                  <span>
                                    {leak.count} {leak.label}
                                  </span>
                                  <ArrowUpRight className="w-3 h-3 text-zinc-500 group-hover:text-white transition" />
                                </Link>
                              );
                            })}
                          </div>

                          <div className="text-[11px] text-zinc-500">
                            Lost at step: <strong className="text-zinc-400">{stage.lost}</strong>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 2: PEAK CALLING HOURS (PKT SYNCHRONIZED)                        */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "HOURLY" && (
        <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span>Peak Calling Hours &amp; Golden Answer Windows</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Empirical hourly pick rates across working hours. Displays both US Prospect Local Time
                and Pakistan Shift Time (PKT).
              </p>
            </div>

            {/* Timezone Switcher */}
            <div className="flex items-center gap-1 bg-[#09090c] border border-zinc-800 rounded-lg p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setHourlyTzMode("PROSPECT")}
                className={`px-3 py-1 rounded font-semibold transition ${
                  hourlyTzMode === "PROSPECT"
                    ? "bg-zinc-800 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Prospect Local Clock (US)
              </button>
              <button
                type="button"
                onClick={() => setHourlyTzMode("CALLER")}
                className={`px-3 py-1 rounded font-semibold transition ${
                  hourlyTzMode === "CALLER"
                    ? "bg-emerald-950 text-emerald-300 border border-emerald-500/40 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                🇵🇰 Caller Shift Clock (PKT)
              </button>
            </div>
          </div>

          {/* Golden Window Highlight Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-950/15 flex items-start gap-3">
              <Flame className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  Golden Calling Window (Highest Decision Maker Connects)
                </span>
                <div className="text-base font-black text-white mt-1">
                  8:30 AM – 10:00 AM &amp; 4:00 PM – 5:30 PM (Prospect Local)
                </div>
                <div className="text-xs text-amber-300 font-mono mt-0.5">
                  🇵🇰 Pakistan Caller Shift: 5:30 PM – 7:00 PM &amp; 1:00 AM – 2:30 AM PKT
                </div>
                <p className="text-[11px] text-zinc-400 mt-2">
                  Owners &amp; executives answer desk phones before admin staff arrives in the morning
                  and after office hours in the late afternoon.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-sky-500/30 bg-sky-950/15 flex items-start gap-3">
              <Globe className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                  Territory Calling Order Strategy
                </span>
                <div className="text-xs text-zinc-300 mt-1 leading-relaxed">
                  Start shifts calling <strong>Eastern (ET)</strong> leads at 5:30 PM PKT (8:30 AM ET),
                  rotate to <strong>Central (CT)</strong> at 6:30 PM PKT, <strong>Mountain (MT)</strong> at
                  7:30 PM PKT, and <strong>Pacific (PT)</strong> at 8:30 PM PKT.
                </div>
              </div>
            </div>
          </div>

          {/* Hourly Distribution Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {(hourlyTzMode === "PROSPECT"
              ? funnelResult.timing.prospectHours
              : funnelResult.timing.callerHours
            )
              .filter((h) => h.hour >= 7 && h.hour <= 19)
              .map((slot) => {
                const isHigh = slot.rate >= 40;
                const isMedium = slot.rate >= 20 && slot.rate < 40;

                return (
                  <div
                    key={slot.hour}
                    className={`p-3.5 rounded-xl border text-left transition ${
                      isHigh
                        ? "border-emerald-500/40 bg-emerald-950/20 shadow-sm"
                        : isMedium
                        ? "border-sky-500/30 bg-[#121217]"
                        : "border-zinc-800 bg-[#09090c]"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono font-bold text-zinc-300">
                      <span>{formatHour12(slot.hour)}</span>
                      {isHigh && (
                        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                      )}
                    </div>
                    <div
                      className={`text-2xl font-black mt-2 font-mono ${
                        isHigh ? "text-emerald-400" : isMedium ? "text-sky-300" : "text-zinc-500"
                      }`}
                    >
                      {slot.rate}%
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-1 flex items-center justify-between">
                      <span>{slot.dials} dials</span>
                      <span>{slot.human} answered</span>
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Timezone Territory Lead Distribution */}
          <div className="pt-4 border-t border-zinc-800/80">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-3">
              Prospect Leads by Timezone Territory
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {funnelResult.timing.zoneLeads.slice(0, 4).map((zone) => {
                const group = US_TZ_GROUPS.find((g) => g.id === zone.groupId);
                const { hour } = group
                  ? wallClock(nowMs, group.iana)
                  : { hour: 0 };
                const isOpen = hour >= 9 && hour < 17;

                return (
                  <div
                    key={zone.groupId}
                    className="p-3 rounded-xl border border-zinc-800 bg-[#09090c]"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-white">US {group?.label || zone.groupId}</span>
                      {isOpen ? (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300">
                          Active Now
                        </span>
                      ) : (
                        <span className="text-[9px] text-zinc-500">Off-Hours</span>
                      )}
                    </div>
                    <div className="text-xl font-black font-mono text-white mt-1">
                      {zone.total} leads
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-0.5 flex justify-between">
                      <span>{zone.untouched} untouched</span>
                      <span>{zone.retry} retries</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 3: CALLER PERFORMANCE LEADERBOARD                              */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "CALLERS" && (
        <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] overflow-hidden shadow-sm">
          <div className="p-6 border-b border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-sky-400" />
                <span>Sales Caller Productivity &amp; Conversion Leaderboard</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Transparent accountability tracking dials logged, owner conversation depth, and meetings booked.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#09090c] text-zinc-400 border-b border-zinc-800 uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-5 py-3">Caller</th>
                  <th className="px-4 py-3">Assigned</th>
                  <th className="px-4 py-3">Dials</th>
                  <th className="px-4 py-3">Pick Rate</th>
                  <th className="px-4 py-3">DM Spoke</th>
                  <th className="px-4 py-3">Gatekeeper</th>
                  <th className="px-4 py-3">Overdue Follow-ups</th>
                  <th className="px-4 py-3 text-right">Meetings Booked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono">
                {funnelResult.callers.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-900/40 transition">
                    <td className="px-5 py-3.5 font-sans">
                      <div className="font-bold text-white text-sm">{c.name}</div>
                      <div className="text-[10px] text-zinc-500">{c.title}</div>
                    </td>
                    <td className="px-4 py-3.5 text-zinc-300">{c.assignedLeads} leads</td>
                    <td className="px-4 py-3.5 font-bold text-white">{c.dials} dials</td>
                    <td className="px-4 py-3.5 text-sky-300 font-bold">{c.pickRate}%</td>
                    <td className="px-4 py-3.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                        {c.owner} Spoke
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-orange-400">{c.gatekeeper} blocked</td>
                    <td className="px-4 py-3.5">
                      {c.overdueFollowUps > 0 ? (
                        <span className="text-rose-400 font-bold">
                          ⚠️ {c.overdueFollowUps} Overdue
                        </span>
                      ) : (
                        <span className="text-zinc-500">0 Overdue</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right font-black text-emerald-400 text-sm">
                      {c.meetings} Booked
                    </td>
                  </tr>
                ))}

                {funnelResult.callers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-zinc-500 font-sans">
                      No active callers found in this workspace. Add team members in Team &amp; Settings.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 4: ICP QUALITY TIERS                                            */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "ICP_QUALITY" && (
        <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-6 shadow-sm space-y-6">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Award className="w-4 h-4 text-purple-400" />
              <span>ICP Lead Quality Score vs. Conversion Correlation</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Empirical evidence demonstrating how deeper research &amp; verified decision-maker info directly multiplies caller conversion rates.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {funnelResult.tiers.map((tier) => (
              <div
                key={tier.id}
                className={`p-5 rounded-xl border space-y-3 ${
                  tier.id === "A"
                    ? "border-emerald-500/30 bg-emerald-950/15"
                    : "border-zinc-800 bg-[#09090c]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">{tier.label}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                    ICP Score {tier.range}
                  </span>
                </div>
                <div className="pt-3 border-t border-zinc-800/80 space-y-1.5 text-xs">
                  <div className="flex justify-between text-zinc-300">
                    <span>Total Leads:</span>
                    <strong className="text-white font-mono">{tier.leads}</strong>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Pick Rate:</span>
                    <strong className="text-sky-300 font-mono">{tier.answerRate}%</strong>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Decision Makers Reached:</span>
                    <strong className="text-indigo-300 font-mono">{tier.owner}</strong>
                  </div>
                  <div className="flex justify-between text-emerald-300 font-bold">
                    <span>Meetings Booked:</span>
                    <strong className="text-emerald-400 font-mono text-sm">{tier.meetings}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 5: DAILY TRENDS                                                */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "TRENDS" && (
        <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-6 shadow-sm space-y-6">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>Daily Conversion Progression</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Daily dial velocity, contact volume, and appointment generation.
            </p>
          </div>

          <div className="space-y-3">
            {funnelResult.daily.map((day) => (
              <div
                key={day.dayKey}
                className="p-3 rounded-xl border border-zinc-800 bg-[#09090c] flex items-center justify-between text-xs"
              >
                <span className="font-mono font-bold text-white">{day.dayLabel}</span>
                <div className="flex items-center gap-4 font-mono">
                  <span className="text-zinc-400">{day.dials} dials</span>
                  <span className="text-indigo-300">{day.human} answered</span>
                  <span className="text-emerald-400 font-bold">{day.meetings} booked</span>
                </div>
              </div>
            ))}

            {funnelResult.daily.length === 0 && (
              <div className="p-8 text-center text-zinc-500 text-xs">
                No call events recorded yet for this timeframe.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
