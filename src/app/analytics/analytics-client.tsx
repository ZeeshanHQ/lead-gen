"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import type { LeadRow } from "@/server/repo/queue";
import type { TeamMember } from "@/server/domain/team";
import { parseLatestCallerNote } from "@/components/crm-date-utils";
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
  Compass,
  RefreshCw,
  Layers,
  PieChart,
  Activity,
  ShieldCheck,
  Sparkles,
  HelpCircle,
  PhoneIncoming,
  PhoneOff,
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

type TimeframeOption = "ALL" | "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "LAST_30_DAYS";
type AnalyticsTab = "OVERVIEW" | "TRENDS" | "HOURLY" | "CALLERS" | "ICP_QUALITY";

interface NormalizedCall {
  id: string;
  companyId?: string | null;
  companyName?: string;
  actor: string;
  outcome: "CONNECTED" | "MEETING_BOOKED" | "GATEKEEPER_BLOCKED" | "NO_ANSWER" | "VOICEMAIL" | "WRONG_NUMBER" | "OTHER";
  notes?: string;
  date: Date;
  dateKey: string; // YYYY-MM-DD
  dayLabel: string; // "Oct 28"
  hour: number; // 0..23
  painIdentified?: boolean;
}

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
  const [timeframe, setTimeframe] = useState<TimeframeOption>("ALL");
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("OVERVIEW");
  const [hoveredDayKey, setHoveredDayKey] = useState<string | null>(null);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);

  // 1. Build Lead Map for fast lookups
  const leadMap = useMemo(() => {
    const map = new Map<string, LeadRow>();
    for (const lead of leads) {
      map.set(lead.id, lead);
    }
    return map;
  }, [leads]);

  // 2. Normalize and Deduplicate all Call Events (from auditLogs + notes fallback)
  const allCalls = useMemo(() => {
    const list: NormalizedCall[] = [];
    const seenSignatures = new Set<string>();

    // A. Audit Log entries (authoritative timestamps & outcomes)
    for (const evt of callEvents) {
      const d = new Date(evt.createdAt);
      if (isNaN(d.getTime())) continue;

      const dateKey = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const hour = d.getHours();

      let normOutcome: NormalizedCall["outcome"] = "OTHER";
      const rawOutcome = evt.callOutcome.toUpperCase();
      if (rawOutcome.includes("MEETING")) normOutcome = "MEETING_BOOKED";
      else if (rawOutcome.includes("CONNECTED") || rawOutcome.includes("SPOKE")) normOutcome = "CONNECTED";
      else if (rawOutcome.includes("GATEKEEPER")) normOutcome = "GATEKEEPER_BLOCKED";
      else if (rawOutcome.includes("NO_ANSWER")) normOutcome = "NO_ANSWER";
      else if (rawOutcome.includes("VOICEMAIL")) normOutcome = "VOICEMAIL";
      else if (rawOutcome.includes("WRONG")) normOutcome = "WRONG_NUMBER";

      const signature = `${evt.companyId || "na"}-${dateKey}-${hour}-${normOutcome}`;
      seenSignatures.add(signature);

      const lead = evt.companyId ? leadMap.get(evt.companyId) : undefined;

      list.push({
        id: evt.id,
        companyId: evt.companyId,
        companyName: lead?.name || "Company Call",
        actor: evt.actor,
        outcome: normOutcome,
        notes: evt.notes,
        date: d,
        dateKey,
        dayLabel,
        hour,
        painIdentified: evt.painIdentified,
      });
    }

    // B. Parse notes from leads as historical fallback
    for (const lead of leads) {
      if (!lead.notes) continue;
      const lines = lead.notes.split("\n");

      for (const line of lines) {
        const match = line.match(/^\[([^•\]]+)(?:•\s*([^(]+))?(?:\(([^)]+)\))?\]:\s*(.*)$/);
        if (match) {
          const rawTime = (match[1] || "").trim();
          const author = (match[2] || "").trim();
          const outcomeRaw = (match[3] || "").trim().toLowerCase();
          const noteText = (match[4] || "").trim();

          const parsedDate = new Date(rawTime);
          const validDate = !isNaN(parsedDate.getTime()) ? parsedDate : new Date(lead.createdAt || Date.now());
          const dateKey = validDate.toISOString().slice(0, 10);
          const dayLabel = validDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const hour = validDate.getHours();

          let normOutcome: NormalizedCall["outcome"] = "OTHER";
          if (outcomeRaw.includes("meeting")) normOutcome = "MEETING_BOOKED";
          else if (outcomeRaw.includes("connected") || outcomeRaw.includes("spoke")) normOutcome = "CONNECTED";
          else if (outcomeRaw.includes("gatekeeper")) normOutcome = "GATEKEEPER_BLOCKED";
          else if (outcomeRaw.includes("no answer")) normOutcome = "NO_ANSWER";
          else if (outcomeRaw.includes("voicemail")) normOutcome = "VOICEMAIL";
          else if (outcomeRaw.includes("wrong")) normOutcome = "WRONG_NUMBER";

          const signature = `${lead.id}-${dateKey}-${hour}-${normOutcome}`;
          if (seenSignatures.has(signature)) continue;
          seenSignatures.add(signature);

          list.push({
            id: `${lead.id}-${validDate.getTime()}`,
            companyId: lead.id,
            companyName: lead.name,
            actor: author || lead.assignedMemberName || "Caller",
            outcome: normOutcome,
            notes: noteText,
            date: validDate,
            dateKey,
            dayLabel,
            hour,
          });
        }
      }
    }

    // Sort calls descending by date
    return list.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [callEvents, leads, leadMap]);

  // 3. Filter by Timeframe & Caller Scope
  const filteredData = useMemo(() => {
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const yesterdayDate = new Date(now.getTime() - 86400000);
    const yesterdayKey = yesterdayDate.toISOString().slice(0, 10);
    const sevenDaysAgo = now.getTime() - 7 * 86400000;
    const thirtyDaysAgo = now.getTime() - 30 * 86400000;

    const callerObj = teamCallers.find((c) => c.id === selectedCallerId);
    const callerNameLower = callerObj?.name.toLowerCase();

    // Filter Leads
    const scopedLeads = leads.filter((lead) => {
      if (lead.status === "REJECTED") return false;
      if (selectedCallerId === "ALL") return true;
      if (selectedCallerId === "UNASSIGNED") return !lead.assignedMemberId;
      return lead.assignedMemberId === selectedCallerId;
    });

    // Filter Calls
    const scopedCalls = allCalls.filter((c) => {
      // Caller Match
      if (selectedCallerId !== "ALL" && selectedCallerId !== "UNASSIGNED") {
        const lead = c.companyId ? leadMap.get(c.companyId) : null;
        const matchesLeadAssignee = lead?.assignedMemberId === selectedCallerId;
        const matchesActor = callerNameLower && c.actor.toLowerCase().includes(callerNameLower);
        if (!matchesLeadAssignee && !matchesActor) return false;
      } else if (selectedCallerId === "UNASSIGNED") {
        const lead = c.companyId ? leadMap.get(c.companyId) : null;
        if (lead?.assignedMemberId) return false;
      }

      // Timeframe Match
      if (timeframe === "TODAY") return c.dateKey === todayKey;
      if (timeframe === "YESTERDAY") return c.dateKey === yesterdayKey;
      if (timeframe === "LAST_7_DAYS") return c.date.getTime() >= sevenDaysAgo;
      if (timeframe === "LAST_30_DAYS") return c.date.getTime() >= thirtyDaysAgo;
      return true;
    });

    // Compute Metrics
    const totalLeads = scopedLeads.length;
    const leadsWithCallsSet = new Set<string>();
    for (const call of scopedCalls) {
      if (call.companyId) leadsWithCallsSet.add(call.companyId);
    }
    const contactedLeadsCount = leadsWithCallsSet.size;
    const untouchedLeadsCount = Math.max(0, totalLeads - contactedLeadsCount);

    const totalDials = scopedCalls.length;
    let meetingsBooked = 0;
    let connectedSpoke = 0;
    let gatekeeperBlocked = 0;
    let noAnswerCount = 0;
    let voicemailCount = 0;
    let wrongNumberCount = 0;
    let otherCount = 0;

    for (const c of scopedCalls) {
      if (c.outcome === "MEETING_BOOKED") meetingsBooked++;
      else if (c.outcome === "CONNECTED") connectedSpoke++;
      else if (c.outcome === "GATEKEEPER_BLOCKED") gatekeeperBlocked++;
      else if (c.outcome === "NO_ANSWER") noAnswerCount++;
      else if (c.outcome === "VOICEMAIL") voicemailCount++;
      else if (c.outcome === "WRONG_NUMBER") wrongNumberCount++;
      else otherCount++;
    }

    const answeredCalls = connectedSpoke + gatekeeperBlocked + voicemailCount + meetingsBooked;
    const pickRate = totalDials > 0 ? Math.round((answeredCalls / totalDials) * 100) : 0;
    const gatekeeperAttempts = connectedSpoke + gatekeeperBlocked + meetingsBooked;
    const gatekeeperBypassRate =
      gatekeeperAttempts > 0
        ? Math.round(((connectedSpoke + meetingsBooked) / gatekeeperAttempts) * 100)
        : 0;
    const totalSpokeOrBooked = connectedSpoke + meetingsBooked;
    const spokeConversionRate =
      totalSpokeOrBooked > 0 ? Math.round((meetingsBooked / totalSpokeOrBooked) * 100) : 0;
    const dialsPerBooking = meetingsBooked > 0 ? Math.round(totalDials / meetingsBooked) : 0;

    // Follow-ups active in lead pool
    const activeFollowUps = scopedLeads.filter(
      (l) => l.notes && l.notes.includes("Follow-up Scheduled")
    ).length;

    // Caller Leaderboard Matrix
    const callerMatrixMap = new Map<
      string,
      {
        id: string;
        name: string;
        title: string;
        assignedLeads: number;
        callsLogged: number;
        meetings: number;
        connected: number;
        gatekeeper: number;
        noAnswer: number;
        voicemail: number;
        conversionRate: number;
      }
    >();

    for (const caller of teamCallers) {
      callerMatrixMap.set(caller.id, {
        id: caller.id,
        name: caller.name,
        title: caller.title || "Sales Caller",
        assignedLeads: 0,
        callsLogged: 0,
        meetings: 0,
        connected: 0,
        gatekeeper: 0,
        noAnswer: 0,
        voicemail: 0,
        conversionRate: 0,
      });
    }

    for (const lead of scopedLeads) {
      if (lead.assignedMemberId && callerMatrixMap.has(lead.assignedMemberId)) {
        callerMatrixMap.get(lead.assignedMemberId)!.assignedLeads++;
      }
    }

    for (const call of scopedCalls) {
      const caller = teamCallers.find(
        (c) =>
          c.name.toLowerCase() === call.actor.toLowerCase() ||
          c.email.toLowerCase() === call.actor.toLowerCase() ||
          (call.companyId && leadMap.get(call.companyId)?.assignedMemberId === c.id)
      );
      if (caller && callerMatrixMap.has(caller.id)) {
        const row = callerMatrixMap.get(caller.id)!;
        row.callsLogged++;
        if (call.outcome === "MEETING_BOOKED") row.meetings++;
        else if (call.outcome === "CONNECTED") row.connected++;
        else if (call.outcome === "GATEKEEPER_BLOCKED") row.gatekeeper++;
        else if (call.outcome === "NO_ANSWER") row.noAnswer++;
        else if (call.outcome === "VOICEMAIL") row.voicemail++;
      }
    }

    for (const row of callerMatrixMap.values()) {
      const spokeTotal = row.connected + row.meetings;
      row.conversionRate = spokeTotal > 0 ? Math.round((row.meetings / spokeTotal) * 100) : 0;
    }

    // Daily Calling Trends (Last 14 days or filtered period)
    const dailyMap = new Map<
      string,
      {
        dateKey: string;
        dayLabel: string;
        dials: number;
        answered: number;
        spoke: number;
        meetings: number;
      }
    >();

    // Seed last 14 days so chart is never empty
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(now.getTime() - i * 86400000);
      const key = dt.toISOString().slice(0, 10);
      const lbl = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      dailyMap.set(key, { dateKey: key, dayLabel: lbl, dials: 0, answered: 0, spoke: 0, meetings: 0 });
    }

    for (const c of scopedCalls) {
      if (!dailyMap.has(c.dateKey)) {
        dailyMap.set(c.dateKey, {
          dateKey: c.dateKey,
          dayLabel: c.dayLabel,
          dials: 0,
          answered: 0,
          spoke: 0,
          meetings: 0,
        });
      }
      const dayEntry = dailyMap.get(c.dateKey)!;
      dayEntry.dials++;
      if (c.outcome !== "NO_ANSWER") dayEntry.answered++;
      if (c.outcome === "CONNECTED" || c.outcome === "MEETING_BOOKED") dayEntry.spoke++;
      if (c.outcome === "MEETING_BOOKED") dayEntry.meetings++;
    }

    const dailyTrendArray = Array.from(dailyMap.values()).slice(-14);

    // Hourly Heatmap (Hours 8 AM to 6 PM)
    const hourlyData: { hour: number; label: string; dials: number; answered: number; pickRate: number }[] = [];
    for (let h = 8; h <= 18; h++) {
      const hourCalls = scopedCalls.filter((c) => c.hour === h);
      const hourDials = hourCalls.length;
      const hourAnswered = hourCalls.filter((c) => c.outcome !== "NO_ANSWER").length;
      const hRate = hourDials > 0 ? Math.round((hourAnswered / hourDials) * 100) : 0;
      const formattedLabel = `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? "PM" : "AM"}`;
      hourlyData.push({
        hour: h,
        label: formattedLabel,
        dials: hourDials,
        answered: hourAnswered,
        pickRate: hRate,
      });
    }

    // ICP Quality Tier Correlation
    const icpTiers = {
      tierA: { label: "Tier A (ICP 80-100)", leads: 0, dials: 0, answered: 0, spoke: 0, booked: 0 },
      tierB: { label: "Tier B (ICP 50-79)", leads: 0, dials: 0, answered: 0, spoke: 0, booked: 0 },
      tierC: { label: "Tier C (ICP <50)", leads: 0, dials: 0, answered: 0, spoke: 0, booked: 0 },
    };

    for (const lead of scopedLeads) {
      const score = lead.icpScore ?? 0;
      const tierKey = score >= 80 ? "tierA" : score >= 50 ? "tierB" : "tierC";
      icpTiers[tierKey].leads++;
      if (lead.status === "MEETING_BOOKED") icpTiers[tierKey].booked++;
      if (["CONNECTED", "PAIN_FOUND", "MEETING_BOOKED"].includes(lead.status)) icpTiers[tierKey].spoke++;
    }

    return {
      totalLeads,
      contactedLeadsCount,
      untouchedLeadsCount,
      totalDials,
      meetingsBooked,
      connectedSpoke,
      gatekeeperBlocked,
      noAnswerCount,
      voicemailCount,
      wrongNumberCount,
      otherCount,
      answeredCalls,
      pickRate,
      gatekeeperBypassRate,
      spokeConversionRate,
      dialsPerBooking,
      activeFollowUps,
      callerMatrix: Array.from(callerMatrixMap.values()),
      dailyTrendArray,
      hourlyData,
      icpTiers,
      scopedCalls,
    };
  }, [leads, allCalls, teamCallers, selectedCallerId, timeframe, leadMap]);

  // Max value for daily trend chart scaling
  const maxDailyDials = useMemo(() => {
    const maxVal = Math.max(...filteredData.dailyTrendArray.map((d) => d.dials), 10);
    return Math.ceil(maxVal * 1.25);
  }, [filteredData.dailyTrendArray]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* 1. Header & Live Feedback Status Bar */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-[#14141a] via-[#101014] to-[#0a0a0d] p-6 shadow-2xl">
        {/* Background glow accent */}
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mb-2">
              <span className="font-semibold text-zinc-300">{tenantName}</span>
              <span>/</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-[#0d0d12] px-2.5 py-0.5 text-zinc-200 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {marketName}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-bold text-indigo-300">
                <Activity className="w-3 h-3 text-indigo-400" />
                <span>Real-Time Sales Intelligence &amp; Feedback Loop</span>
              </span>
            </div>

            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight flex items-center gap-3">
              <TrendingUp className="w-7 h-7 text-indigo-400" />
              <span>Sales Pipeline Tracking &amp; Executive Analytics</span>
            </h1>
            <p className="text-xs md:text-sm text-zinc-400 mt-1 max-w-3xl leading-relaxed">
              Track conversion telemetry at every touchpoint: dial coverage, pick rates, gatekeeper resistance, decision maker connection, and booked demos. Use data-backed feedback loops to make instant operational decisions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/caller"
              className="inline-flex items-center gap-2 rounded-xl bg-white hover:bg-zinc-200 px-4 py-2.5 text-xs font-bold text-black transition shadow-md"
            >
              <PhoneCall className="w-3.5 h-3.5 text-black" />
              <span>Caller Workbench</span>
              <ArrowRight className="w-3.5 h-3.5 ml-0.5 text-zinc-700" />
            </Link>
          </div>
        </div>

        {/* Dynamic Filters Toolbar */}
        <div className="mt-6 pt-5 border-t border-zinc-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
          {/* Timeframe Selector */}
          <div className="flex flex-wrap items-center gap-1.5 bg-[#09090c] p-1.5 rounded-xl border border-zinc-800">
            <span className="text-[11px] font-semibold text-zinc-500 px-2 flex items-center gap-1">
              <Clock className="w-3 h-3 text-zinc-500" />
              <span>Period:</span>
            </span>
            {(
              [
                ["ALL", "All Time"],
                ["TODAY", "Today"],
                ["YESTERDAY", "Yesterday"],
                ["LAST_7_DAYS", "Last 7 Days"],
                ["LAST_30_DAYS", "Last 30 Days"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setTimeframe(val)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  timeframe === val
                    ? "bg-white text-black shadow-sm font-bold"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Caller Scope Selector */}
          <div className="flex flex-wrap items-center gap-1.5 bg-[#09090c] p-1.5 rounded-xl border border-zinc-800">
            <span className="text-[11px] font-semibold text-zinc-500 px-2 flex items-center gap-1">
              <Filter className="w-3 h-3 text-zinc-500" />
              <span>Scope:</span>
            </span>
            <button
              type="button"
              onClick={() => setSelectedCallerId("ALL")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                selectedCallerId === "ALL"
                  ? "bg-indigo-600 text-white font-bold shadow-sm"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"
              }`}
            >
              All Team
            </button>
            <button
              type="button"
              onClick={() => setSelectedCallerId("UNASSIGNED")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                selectedCallerId === "UNASSIGNED"
                  ? "bg-indigo-600 text-white font-bold shadow-sm"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"
              }`}
            >
              Unassigned Pool
            </button>
            {teamCallers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCallerId(c.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                  selectedCallerId === c.id
                    ? "bg-indigo-600 text-white font-bold shadow-sm"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Top-Tier Executive KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Metric 1: Total Dials & Coverage */}
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#101014] p-4.5 hover:border-zinc-700 transition">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span className="font-semibold text-zinc-300">Outbound Dials</span>
            <PhoneCall className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-3xl font-black text-white mt-1.5 tracking-tight font-mono">
            {filteredData.totalDials}
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 flex items-center justify-between">
            <span>{filteredData.contactedLeadsCount} leads contacted</span>
            <span className="text-indigo-400 font-semibold">
              {filteredData.totalLeads > 0
                ? Math.round((filteredData.contactedLeadsCount / filteredData.totalLeads) * 100)
                : 0}
              % pool coverage
            </span>
          </div>
        </div>

        {/* Metric 2: Human Answer Rate */}
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#101014] p-4.5 hover:border-zinc-700 transition">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span className="font-semibold text-zinc-300">Pick / Answer Rate</span>
            <PhoneForwarded className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-3xl font-black text-sky-300 mt-1.5 tracking-tight font-mono">
            {filteredData.pickRate}%
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 flex items-center justify-between">
            <span className="text-zinc-400">{filteredData.answeredCalls} calls answered</span>
            <span className="text-amber-400/90 font-medium">{filteredData.noAnswerCount} rang out</span>
          </div>
        </div>

        {/* Metric 3: Gatekeeper Bypass */}
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#101014] p-4.5 hover:border-zinc-700 transition">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span className="font-semibold text-zinc-300">Gatekeeper Bypass</span>
            <ShieldAlert className="w-4 h-4 text-orange-400" />
          </div>
          <div className="text-3xl font-black text-orange-300 mt-1.5 tracking-tight font-mono">
            {filteredData.gatekeeperBypassRate}%
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 flex items-center justify-between">
            <span className="text-orange-400">{filteredData.gatekeeperBlocked} blocked</span>
            <span className="text-emerald-400 font-semibold">
              {filteredData.connectedSpoke + filteredData.meetingsBooked} reached DM
            </span>
          </div>
        </div>

        {/* Metric 4: Decision Maker Conversations */}
        <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-[#101014] p-4.5 hover:border-zinc-700 transition">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span className="font-semibold text-zinc-300">DM Conversations</span>
            <Target className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-3xl font-black text-indigo-300 mt-1.5 tracking-tight font-mono">
            {filteredData.connectedSpoke}
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 flex items-center justify-between">
            <span>Direct owner talks</span>
            <span className="text-indigo-400 font-semibold">{filteredData.activeFollowUps} follow-ups</span>
          </div>
        </div>

        {/* Metric 5: Meetings Booked & Close Rate */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4.5 hover:border-emerald-500/50 transition">
          <div className="flex items-center justify-between text-emerald-300 text-xs font-semibold">
            <span>Meetings Booked</span>
            <CalendarCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-black text-emerald-400 mt-1.5 tracking-tight font-mono">
            {filteredData.meetingsBooked}
          </div>
          <div className="text-[11px] text-emerald-300/80 mt-1 flex items-center justify-between font-medium">
            <span>{filteredData.spokeConversionRate}% spoke &rarr; demo</span>
            <span>{filteredData.dialsPerBooking > 0 ? `${filteredData.dialsPerBooking} dials/deal` : "Active"}</span>
          </div>
        </div>
      </div>

      {/* 3. Actionable Closed-Loop Triggers (Data-Driven Decisions) */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Process Health &amp; Next Decision Directives
            </h2>
          </div>
          <span className="text-[11px] text-zinc-500">Continuous Closed-Loop Feedback</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Directive 1: Untouched Leads */}
          <div className="p-3.5 rounded-xl bg-[#09090c] border border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Fresh Untouched
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {filteredData.untouchedLeadsCount} Leads
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              {filteredData.untouchedLeadsCount > 0
                ? `${filteredData.untouchedLeadsCount} verified leads have zero dials. Speed-to-lead dictates contacting them within 24 hours.`
                : "100% of available leads have received outreach. Pipeline coverage is maximized."}
            </p>
            <Link
              href="/caller"
              className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold inline-flex items-center gap-1 pt-1"
            >
              <span>Distribute &amp; Dial Untouched &rarr;</span>
            </Link>
          </div>

          {/* Directive 2: Stalled No-Answers */}
          <div className="p-3.5 rounded-xl bg-[#09090c] border border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <PhoneOff className="w-3.5 h-3.5 text-sky-400" />
                No Answer Redials
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">
                {filteredData.noAnswerCount} Dials
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Calls rang out without pickup. Shifting redials to 4:00 PM – 5:30 PM recovers up to 28% of unreachable decision makers.
            </p>
            <Link
              href="/caller"
              className="text-[11px] text-sky-400 hover:text-sky-300 font-semibold inline-flex items-center gap-1 pt-1"
            >
              <span>View No-Answer Queue &rarr;</span>
            </Link>
          </div>

          {/* Directive 3: Gatekeeper Resistance */}
          <div className="p-3.5 rounded-xl bg-[#09090c] border border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-orange-400" />
                Gatekeeper Bounces
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20">
                {filteredData.gatekeeperBlocked} Blocked
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Front desk blocked transfer. Apply the &ldquo;First-Name Only&rdquo; casual authority rule or dial off-hours at 8:15 AM.
            </p>
            <Link
              href="/caller"
              className="text-[11px] text-orange-400 hover:text-orange-300 font-semibold inline-flex items-center gap-1 pt-1"
            >
              <span>Review Gatekeeper Bounces &rarr;</span>
            </Link>
          </div>

          {/* Directive 4: Follow-up Execution */}
          <div className="p-3.5 rounded-xl bg-[#09090c] border border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                <CalendarCheck className="w-3.5 h-3.5 text-emerald-400" />
                Follow-up Retention
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {filteredData.activeFollowUps} Active
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Scheduled callbacks represent warm pipeline. Ensure callers honor exact scheduled times to protect closing velocity.
            </p>
            <Link
              href="/caller"
              className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1 pt-1"
            >
              <span>Open Follow-Up Calendar &rarr;</span>
            </Link>
          </div>
        </div>
      </div>

      {/* 4. Section Navigation Tabs */}
      <div className="flex items-center border-b border-zinc-800 bg-[#0c0c10] rounded-xl p-1 overflow-x-auto gap-1">
        <button
          type="button"
          onClick={() => setActiveTab("OVERVIEW")}
          className={`flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold transition whitespace-nowrap ${
            activeTab === "OVERVIEW"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
          <span>Stepped Funnel &amp; Distribution</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("TRENDS")}
          className={`flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold transition whitespace-nowrap ${
            activeTab === "TRENDS"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5 text-sky-400" />
          <span>Daily Calling Trends (14-Day Velocity)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("HOURLY")}
          className={`flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold transition whitespace-nowrap ${
            activeTab === "HOURLY"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          }`}
        >
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span>Peak Hours &amp; Golden Window</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("CALLERS")}
          className={`flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold transition whitespace-nowrap ${
            activeTab === "CALLERS"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          }`}
        >
          <Users className="w-3.5 h-3.5 text-emerald-400" />
          <span>Caller Leaderboard &amp; Matrix</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("ICP_QUALITY")}
          className={`flex items-center gap-2 py-2 px-4 rounded-lg text-xs font-bold transition whitespace-nowrap ${
            activeTab === "ICP_QUALITY"
              ? "bg-zinc-800 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
          }`}
        >
          <Award className="w-3.5 h-3.5 text-purple-400" />
          <span>Lead Quality Tier Impact</span>
        </button>
      </div>

      {/* TAB 1: OVERVIEW & STEPPED FUNNEL */}
      {activeTab === "OVERVIEW" && (
        <div className="space-y-6">
          {/* Stepped Funnel Progression */}
          <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-400" />
                  <span>5-Stage Sales Funnel Conversion</span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Step-by-step conversion progression showing exactly where leads drop off and where deals close.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Stage 1: Lead Pool */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-300 mb-1.5">
                  <span className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-200 flex items-center justify-center text-[10px] font-bold">1</span>
                    <span>Total Outbound Leads In CRM</span>
                  </span>
                  <span className="text-white font-bold">{filteredData.totalLeads} leads (100%)</span>
                </div>
                <div className="w-full h-5 rounded-lg bg-zinc-900 overflow-hidden border border-zinc-800 flex">
                  <div className="h-full bg-zinc-600 transition-all duration-500" style={{ width: "100%" }} />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1">
                  <span>{filteredData.contactedLeadsCount} contacted ({filteredData.totalDials} dials logged)</span>
                  <span className="text-amber-400">{filteredData.untouchedLeadsCount} untouched leads awaiting dial</span>
                </div>
              </div>

              {/* Stage 2: Pick Up / Answer */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-300 mb-1.5">
                  <span className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-sky-950 text-sky-300 flex items-center justify-center text-[10px] font-bold">2</span>
                    <span>Calls Answered (Pick Rate)</span>
                  </span>
                  <span className="text-sky-300 font-bold">
                    {filteredData.answeredCalls} of {filteredData.totalDials} dials ({filteredData.pickRate}%)
                  </span>
                </div>
                <div className="w-full h-5 rounded-lg bg-zinc-900 overflow-hidden border border-zinc-800 flex">
                  <div
                    className="h-full bg-sky-500 transition-all duration-500"
                    style={{ width: `${Math.max(5, filteredData.pickRate)}%` }}
                  />
                  <div
                    className="h-full bg-amber-500/30 transition-all duration-500"
                    style={{ width: `${Math.max(0, 100 - filteredData.pickRate)}%` }}
                    title={`${filteredData.noAnswerCount} No-Answer`}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1">
                  <span className="text-sky-400">{filteredData.answeredCalls} calls connected with human or IVR</span>
                  <span className="text-amber-400/90">{filteredData.noAnswerCount} rang out ({filteredData.totalDials > 0 ? Math.round((filteredData.noAnswerCount / filteredData.totalDials) * 100) : 0}% missed)</span>
                </div>
              </div>

              {/* Stage 3: Gatekeeper Bypass */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-300 mb-1.5">
                  <span className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-orange-950 text-orange-300 flex items-center justify-center text-[10px] font-bold">3</span>
                    <span>Gatekeeper Bypassed (Passed Front Desk)</span>
                  </span>
                  <span className="text-orange-300 font-bold">
                    {filteredData.connectedSpoke + filteredData.meetingsBooked} reached DM ({filteredData.gatekeeperBypassRate}% bypass)
                  </span>
                </div>
                <div className="w-full h-5 rounded-lg bg-zinc-900 overflow-hidden border border-zinc-800 flex">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${Math.max(5, filteredData.gatekeeperBypassRate)}%` }}
                  />
                  <div
                    className="h-full bg-orange-500/30 transition-all duration-500"
                    style={{ width: `${Math.max(0, 100 - filteredData.gatekeeperBypassRate)}%` }}
                    title={`${filteredData.gatekeeperBlocked} Gatekeeper Blocked`}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1">
                  <span className="text-indigo-400">Transferred directly to decision maker</span>
                  <span className="text-orange-400">{filteredData.gatekeeperBlocked} blocked by assistant</span>
                </div>
              </div>

              {/* Stage 4: Decision Maker Spoke */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-300 mb-1.5">
                  <span className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-950 text-indigo-300 flex items-center justify-center text-[10px] font-bold">4</span>
                    <span>Decision Maker 2-Way Discovery</span>
                  </span>
                  <span className="text-indigo-300 font-bold">
                    {filteredData.connectedSpoke} Conversations
                  </span>
                </div>
                <div className="w-full h-5 rounded-lg bg-zinc-900 overflow-hidden border border-zinc-800 flex">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${Math.max(5, filteredData.totalDials > 0 ? Math.round((filteredData.connectedSpoke / filteredData.totalDials) * 100) : 0)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1">
                  <span className="text-indigo-300">Live discovery conversations with Owners &amp; Executives</span>
                  <span className="text-indigo-400">{filteredData.activeFollowUps} warm callbacks scheduled</span>
                </div>
              </div>

              {/* Stage 5: Meeting Booked */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-300 mb-1.5">
                  <span className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-300 flex items-center justify-center text-[10px] font-bold">5</span>
                    <span>Appointments &amp; Demos Booked</span>
                  </span>
                  <span className="text-emerald-400 font-bold">
                    {filteredData.meetingsBooked} Booked ({filteredData.spokeConversionRate}% of spoke)
                  </span>
                </div>
                <div className="w-full h-5 rounded-lg bg-zinc-900 overflow-hidden border border-zinc-800 flex">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${Math.max(3, filteredData.spokeConversionRate)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1">
                  <span className="text-emerald-400 font-semibold">{filteredData.meetingsBooked} qualified meetings booked</span>
                  <span className="text-emerald-300/80">{filteredData.dialsPerBooking > 0 ? `${filteredData.dialsPerBooking} dials per booked demo` : "Active pipeline"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Outcome Distribution Splitter Bar */}
          <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-6 shadow-sm">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <PieChart className="w-4 h-4 text-sky-400" />
              <span>Dial Outcome Distribution Matrix</span>
            </h3>
            <p className="text-xs text-zinc-400 mb-4">
              Breakdown of all {filteredData.totalDials} logged call attempts across response categories.
            </p>

            <div className="w-full h-4 rounded-full bg-zinc-900 overflow-hidden flex border border-zinc-800">
              {filteredData.totalDials > 0 ? (
                <>
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${(filteredData.meetingsBooked / filteredData.totalDials) * 100}%` }}
                    title={`Meeting Booked: ${filteredData.meetingsBooked}`}
                  />
                  <div
                    className="h-full bg-indigo-500"
                    style={{ width: `${(filteredData.connectedSpoke / filteredData.totalDials) * 100}%` }}
                    title={`Connected / Spoke: ${filteredData.connectedSpoke}`}
                  />
                  <div
                    className="h-full bg-orange-500"
                    style={{ width: `${(filteredData.gatekeeperBlocked / filteredData.totalDials) * 100}%` }}
                    title={`Gatekeeper: ${filteredData.gatekeeperBlocked}`}
                  />
                  <div
                    className="h-full bg-amber-500"
                    style={{ width: `${(filteredData.noAnswerCount / filteredData.totalDials) * 100}%` }}
                    title={`No Answer: ${filteredData.noAnswerCount}`}
                  />
                  <div
                    className="h-full bg-zinc-600"
                    style={{
                      width: `${
                        ((filteredData.voicemailCount + filteredData.wrongNumberCount + filteredData.otherCount) /
                          filteredData.totalDials) *
                        100
                      }%`,
                    }}
                    title="Voicemail / Other"
                  />
                </>
              ) : (
                <div className="h-full w-full bg-zinc-800" />
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-zinc-300">Booked:</span>
                <strong className="text-white font-mono">{filteredData.meetingsBooked}</strong>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <span className="text-zinc-300">Spoke:</span>
                <strong className="text-white font-mono">{filteredData.connectedSpoke}</strong>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                <span className="text-zinc-300">Gatekeeper:</span>
                <strong className="text-white font-mono">{filteredData.gatekeeperBlocked}</strong>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-zinc-300">No Answer:</span>
                <strong className="text-white font-mono">{filteredData.noAnswerCount}</strong>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-600" />
                <span className="text-zinc-300">Voicemail/Other:</span>
                <strong className="text-white font-mono">{filteredData.voicemailCount + filteredData.otherCount}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DAILY CALLING TRENDS (Interactive SVG Chart) */}
      {activeTab === "TRENDS" && (
        <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-sky-400" />
                <span>Daily Outreach Velocity &amp; Conversion Timeline</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                14-day chronological chart of outbound dials, answered calls, and meetings booked.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-3 h-3 rounded bg-indigo-500" /> Dials
              </span>
              <span className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-3 h-3 rounded bg-sky-400" /> Answered
              </span>
              <span className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-3 h-3 rounded bg-emerald-400" /> Bookings
              </span>
            </div>
          </div>

          {/* Custom SVG Bar Chart */}
          <div className="w-full overflow-x-auto pt-4 pb-2">
            <div className="min-w-[650px] h-64 flex items-end justify-between gap-2 px-2 border-b border-zinc-800">
              {filteredData.dailyTrendArray.map((day) => {
                const dialHeight = (day.dials / maxDailyDials) * 100;
                const answeredHeight = (day.answered / maxDailyDials) * 100;
                const meetingsHeight = (day.meetings / maxDailyDials) * 100;
                const isHovered = hoveredDayKey === day.dateKey;

                return (
                  <div
                    key={day.dateKey}
                    onMouseEnter={() => setHoveredDayKey(day.dateKey)}
                    onMouseLeave={() => setHoveredDayKey(null)}
                    className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer relative"
                  >
                    {/* Hover Tooltip */}
                    {isHovered && (
                      <div className="absolute -top-16 z-30 bg-[#16161d] border border-zinc-700 p-2 rounded-lg shadow-xl text-[10px] whitespace-nowrap text-left pointer-events-none">
                        <div className="font-bold text-white">{day.dayLabel}</div>
                        <div className="text-indigo-300">{day.dials} Dials Made</div>
                        <div className="text-sky-300">{day.answered} Answered ({day.dials > 0 ? Math.round((day.answered / day.dials) * 100) : 0}%)</div>
                        <div className="text-emerald-400 font-bold">{day.meetings} Booked</div>
                      </div>
                    )}

                    {/* Bars Container */}
                    <div className="w-full flex items-end justify-center gap-1 h-full pb-1">
                      {/* Dials Bar */}
                      <div
                        className={`w-3.5 rounded-t transition-all duration-300 ${
                          isHovered ? "bg-indigo-400" : "bg-indigo-600/80 hover:bg-indigo-500"
                        }`}
                        style={{ height: `${Math.max(day.dials > 0 ? 8 : 2, dialHeight)}%` }}
                        title={`${day.dayLabel}: ${day.dials} dials`}
                      />
                      {/* Answered Bar */}
                      <div
                        className={`w-2.5 rounded-t transition-all duration-300 ${
                          isHovered ? "bg-sky-300" : "bg-sky-500/70"
                        }`}
                        style={{ height: `${Math.max(day.answered > 0 ? 6 : 0, answeredHeight)}%` }}
                        title={`${day.dayLabel}: ${day.answered} answered`}
                      />
                      {/* Meetings Bar */}
                      {day.meetings > 0 && (
                        <div
                          className="w-2.5 rounded-t bg-emerald-400 shadow-sm transition-all duration-300"
                          style={{ height: `${Math.max(12, meetingsHeight)}%` }}
                          title={`${day.dayLabel}: ${day.meetings} meetings booked`}
                        />
                      )}
                    </div>

                    <span className="text-[10px] text-zinc-500 group-hover:text-zinc-200 mt-2 font-mono">
                      {day.dayLabel.split(" ")[1]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="text-[11px] text-zinc-500 text-center">
            Daily activity chart based on real-time event logs &bull; Hover over any column to inspect detailed conversion metrics.
          </div>
        </div>
      )}

      {/* TAB 3: BEST CALLING HOURS (Heatmap) */}
      {activeTab === "HOURLY" && (
        <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span>Peak Calling Hours &amp; Golden Answer Windows</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Empirical hourly pick rates across working hours (8:00 AM – 6:00 PM). Schedule calling blocks during peak green windows.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                Golden Window: 8:30–10:00 AM &amp; 4:00–5:30 PM
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {filteredData.hourlyData.map((slot) => {
              const isHigh = slot.pickRate >= 45;
              const isMedium = slot.pickRate >= 25 && slot.pickRate < 45;

              return (
                <div
                  key={slot.hour}
                  onMouseEnter={() => setHoveredHour(slot.hour)}
                  onMouseLeave={() => setHoveredHour(null)}
                  className={`p-3.5 rounded-xl border text-left transition ${
                    isHigh
                      ? "border-emerald-500/40 bg-emerald-950/20 shadow-sm"
                      : isMedium
                      ? "border-sky-500/30 bg-[#121217]"
                      : "border-zinc-800 bg-[#09090c]"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-mono font-bold text-zinc-300">
                    <span>{slot.label}</span>
                    {isHigh && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />}
                  </div>
                  <div
                    className={`text-2xl font-black mt-2 font-mono ${
                      isHigh ? "text-emerald-400" : isMedium ? "text-sky-300" : "text-zinc-400"
                    }`}
                  >
                    {slot.pickRate}%
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-1 flex items-center justify-between">
                    <span>{slot.dials} dials</span>
                    <span>{slot.answered} pickups</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 rounded-xl bg-[#09090c] border border-zinc-800 text-xs text-zinc-300 flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="text-white">Caller Timing Strategy:</strong> Business owners and executives check voicemail and answer desk phones before administrative staff arrives (8:00–9:30 AM) and after office staff leaves (4:30–5:30 PM). Dials made during these two windows achieve up to <strong>2.8x higher decision-maker contact rates</strong> than midday calling.
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: CALLER PERFORMANCE & LEADERBOARD */}
      {activeTab === "CALLERS" && (
        <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] overflow-hidden shadow-sm">
          <div className="p-6 border-b border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Caller Performance Matrix &amp; Conversion Efficiency</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Head-to-head comparison of dial volume, DM conversations, gatekeeper navigation, and closed meetings.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#09090c] text-[11px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="px-5 py-3.5">Caller Name</th>
                  <th className="px-4 py-3.5">Assigned Leads</th>
                  <th className="px-4 py-3.5">Total Dials</th>
                  <th className="px-4 py-3.5">Connected / Spoke</th>
                  <th className="px-4 py-3.5">Gatekeeper Blocked</th>
                  <th className="px-4 py-3.5">No Answer %</th>
                  <th className="px-4 py-3.5">Meetings Booked</th>
                  <th className="px-4 py-3.5 text-right">Spoke &rarr; Demo %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-medium">
                {filteredData.callerMatrix.map((c) => {
                  return (
                    <tr key={c.id} className="hover:bg-zinc-900/60 transition">
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <div className="font-bold text-white flex items-center gap-2">
                          <span>{c.name}</span>
                          {c.meetings >= 3 ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                              <Award className="w-3 h-3" /> Top Closer
                            </span>
                          ) : c.callsLogged >= 50 ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              High Volume
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-zinc-500">{c.title}</div>
                      </td>
                      <td className="px-4 py-3.5 text-zinc-300">{c.assignedLeads} leads</td>
                      <td className="px-4 py-3.5 font-bold text-white">{c.callsLogged} dials</td>
                      <td className="px-4 py-3.5">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30">
                          {c.connected} Spoke
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-orange-500/15 text-orange-300 border border-orange-500/30">
                          {c.gatekeeper} Blocked
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-zinc-400">
                        {c.callsLogged > 0 ? Math.round((c.noAnswer / c.callsLogged) * 100) : 0}%
                      </td>
                      <td className="px-4 py-3.5 font-black text-emerald-400 text-sm">
                        {c.meetings} Booked
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-white">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded text-xs ${
                            c.conversionRate >= 20
                              ? "bg-emerald-500/20 text-emerald-300 font-black border border-emerald-500/30"
                              : c.conversionRate > 0
                              ? "bg-indigo-500/20 text-indigo-300"
                              : "text-zinc-500"
                          }`}
                        >
                          {c.conversionRate}%
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {filteredData.callerMatrix.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-zinc-500">
                      No callers found in this workspace. Add team members in Team &amp; Settings.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: LEAD QUALITY TIER IMPACT */}
      {activeTab === "ICP_QUALITY" && (
        <div className="rounded-2xl border border-zinc-800/80 bg-[#101014] p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Award className="w-4 h-4 text-purple-400" />
                <span>ICP Lead Quality Score vs. Conversion Correlation</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Empirical evidence demonstrating how deeper research &amp; higher ICP confidence directly multiply caller conversion rates.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Tier A */}
            <div className="p-5 rounded-xl border border-emerald-500/30 bg-emerald-950/15 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-300 text-sm">Tier A: Elite Matches</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                  ICP Score 80–100
                </span>
              </div>
              <p className="text-xs text-zinc-300">
                Verified owner name, confirmed direct phone, and high niche alignment.
              </p>
              <div className="pt-3 border-t border-emerald-500/20 space-y-1.5 text-xs">
                <div className="flex justify-between text-zinc-300">
                  <span>Total Leads:</span>
                  <strong className="text-white font-mono">{filteredData.icpTiers.tierA.leads}</strong>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Conversations:</span>
                  <strong className="text-sky-300 font-mono">{filteredData.icpTiers.tierA.spoke}</strong>
                </div>
                <div className="flex justify-between text-emerald-300 font-bold">
                  <span>Meetings Booked:</span>
                  <strong className="text-emerald-400 font-mono text-sm">{filteredData.icpTiers.tierA.booked}</strong>
                </div>
              </div>
            </div>

            {/* Tier B */}
            <div className="p-5 rounded-xl border border-zinc-800 bg-[#09090c] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-zinc-200 text-sm">Tier B: Standard Matches</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                  ICP Score 50–79
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Active company profile with general office switchboard phone.
              </p>
              <div className="pt-3 border-t border-zinc-800 space-y-1.5 text-xs">
                <div className="flex justify-between text-zinc-300">
                  <span>Total Leads:</span>
                  <strong className="text-white font-mono">{filteredData.icpTiers.tierB.leads}</strong>
                </div>
                <div className="flex justify-between text-zinc-300">
                  <span>Conversations:</span>
                  <strong className="text-sky-300 font-mono">{filteredData.icpTiers.tierB.spoke}</strong>
                </div>
                <div className="flex justify-between text-zinc-300 font-bold">
                  <span>Meetings Booked:</span>
                  <strong className="text-white font-mono text-sm">{filteredData.icpTiers.tierB.booked}</strong>
                </div>
              </div>
            </div>

            {/* Tier C */}
            <div className="p-5 rounded-xl border border-zinc-800/80 bg-[#09090c] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-zinc-400 text-sm">Tier C: Broad Matches</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800/60 text-zinc-400">
                  ICP Score &lt;50
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                Early discovery leads without deep research verification.
              </p>
              <div className="pt-3 border-t border-zinc-800 space-y-1.5 text-xs">
                <div className="flex justify-between text-zinc-400">
                  <span>Total Leads:</span>
                  <strong className="text-zinc-300 font-mono">{filteredData.icpTiers.tierC.leads}</strong>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Conversations:</span>
                  <strong className="text-zinc-300 font-mono">{filteredData.icpTiers.tierC.spoke}</strong>
                </div>
                <div className="flex justify-between text-zinc-400 font-bold">
                  <span>Meetings Booked:</span>
                  <strong className="text-zinc-300 font-mono text-sm">{filteredData.icpTiers.tierC.booked}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
