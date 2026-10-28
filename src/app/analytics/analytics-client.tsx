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
} from "lucide-react";

interface SalesFunnelClientProps {
  leads: LeadRow[];
  teamCallers: TeamMember[];
  marketName: string;
  tenantName: string;
  isOwner: boolean;
  activeMemberName?: string;
}

export function SalesFunnelClient({
  leads,
  teamCallers,
  marketName,
  tenantName,
  isOwner,
  activeMemberName,
}: SalesFunnelClientProps) {
  const [selectedCallerId, setSelectedCallerId] = useState<string>("ALL");
  const [timeFilter, setTimeFilter] = useState<"ALL" | "TODAY" | "THIS_WEEK">("ALL");

  // Filter leads based on selected caller
  const relevantLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (lead.status === "REJECTED") return false;
      if (selectedCallerId === "ALL") return true;
      if (selectedCallerId === "UNASSIGNED") return !lead.assignedMemberId;
      return lead.assignedMemberId === selectedCallerId;
    });
  }, [leads, selectedCallerId]);

  // Compute detailed call metrics & funnel data
  const funnelData = useMemo(() => {
    let totalLeads = relevantLeads.length;
    let leadsWithCalls = 0;
    let totalCallsLogged = 0;

    let meetingsBooked = 0;
    let connectedSpoke = 0;
    let gatekeeperBlocked = 0;
    let noAnswerCount = 0;
    let voicemailCount = 0;
    let wrongNumberCount = 0;
    let followUpsCount = 0;

    // Caller-specific stats map
    const callerMatrix: Record<
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
        followUps: number;
      }
    > = {};

    for (const c of teamCallers) {
      callerMatrix[c.id] = {
        id: c.id,
        name: c.name,
        title: c.title || "Sales Caller",
        assignedLeads: 0,
        callsLogged: 0,
        meetings: 0,
        connected: 0,
        gatekeeper: 0,
        noAnswer: 0,
        voicemail: 0,
        followUps: 0,
      };
    }

    for (const lead of relevantLeads) {
      if (lead.assignedMemberId && callerMatrix[lead.assignedMemberId]) {
        callerMatrix[lead.assignedMemberId]!.assignedLeads++;
      }
      if (lead.notes && lead.notes.includes("Follow-up Scheduled")) {
        followUpsCount++;
        if (lead.assignedMemberId && callerMatrix[lead.assignedMemberId]) {
          callerMatrix[lead.assignedMemberId]!.followUps++;
        }
      }

      if (lead.notes) {
        const lines = lead.notes.split("\n");
        let leadHadCalls = false;

        for (const line of lines) {
          const match = line.match(/^\[([^•\]]+)(?:•\s*([^(]+))?(?:\(([^)]+)\))?\]:/);
          if (match) {
            leadHadCalls = true;
            totalCallsLogged++;

            const author = (match[2] || "").trim().toLowerCase();
            const outcome = (match[3] || "").trim().toLowerCase();

            const targetCaller = teamCallers.find(
              (c) =>
                c.name.toLowerCase() === author ||
                c.email.toLowerCase() === author ||
                (lead.assignedMemberId === c.id && !author)
            );
            const entry = targetCaller ? callerMatrix[targetCaller.id] : null;
            if (entry) {
              entry.callsLogged++;
            }

            if (outcome.includes("meeting")) {
              meetingsBooked++;
              if (entry) entry.meetings++;
            } else if (outcome.includes("connected") || outcome.includes("spoke")) {
              connectedSpoke++;
              if (entry) entry.connected++;
            } else if (outcome.includes("gatekeeper")) {
              gatekeeperBlocked++;
              if (entry) entry.gatekeeper++;
            } else if (outcome.includes("no answer")) {
              noAnswerCount++;
              if (entry) entry.noAnswer++;
            } else if (outcome.includes("voicemail")) {
              voicemailCount++;
              if (entry) entry.voicemail++;
            } else if (outcome.includes("wrong number")) {
              wrongNumberCount++;
            }
          }
        }
        if (leadHadCalls) leadsWithCalls++;
      }
    }

    // Rate calculations
    const answeredCalls = connectedSpoke + gatekeeperBlocked + voicemailCount + meetingsBooked;
    const pickRate = totalCallsLogged > 0 ? Math.round((answeredCalls / totalCallsLogged) * 100) : 0;
    const gatekeeperAttempts = connectedSpoke + gatekeeperBlocked + meetingsBooked;
    const gatekeeperBypassRate =
      gatekeeperAttempts > 0
        ? Math.round(((connectedSpoke + meetingsBooked) / gatekeeperAttempts) * 100)
        : 0;
    const spokeConversionRate =
      connectedSpoke + meetingsBooked > 0
        ? Math.round((meetingsBooked / (connectedSpoke + meetingsBooked)) * 100)
        : 0;

    return {
      totalLeads,
      leadsWithCalls,
      untouchedLeads: Math.max(0, totalLeads - leadsWithCalls),
      totalCallsLogged,
      meetingsBooked,
      connectedSpoke,
      gatekeeperBlocked,
      noAnswerCount,
      voicemailCount,
      wrongNumberCount,
      followUpsCount,
      pickRate,
      gatekeeperBypassRate,
      spokeConversionRate,
      callerMatrix: Object.values(callerMatrix),
    };
  }, [relevantLeads, teamCallers]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. Header & Context */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mb-1.5">
              <span className="font-medium text-zinc-300">{tenantName}</span>
              <span>/</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-[#09090b] px-2.5 py-0.5 text-zinc-200 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {marketName}
              </span>
              <span className="inline-flex items-center rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold text-indigo-300">
                Sales Funnel Intelligence
              </span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
              <TrendingUp className="w-6 h-6 text-indigo-400" />
              <span>Cold Calling Funnel &amp; Bottleneck Diagnostics</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
              Track pick rates, gatekeeper resistance, decision maker connections, and demo conversions in real time. Identify where leads drop off and optimize team performance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/caller"
              className="inline-flex items-center gap-2 rounded-xl bg-white hover:bg-zinc-200 px-4 py-2 text-xs font-bold text-black transition shadow-sm"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Open Leads CRM</span>
              <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
            </Link>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="mt-5 pt-4 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1 mr-1">
              <Filter className="w-3 h-3 text-zinc-500" />
              <span>Scope:</span>
            </span>
            <button
              type="button"
              onClick={() => setSelectedCallerId("ALL")}
              className={`px-3 py-1 rounded-lg border text-xs font-medium transition ${
                selectedCallerId === "ALL"
                  ? "border-indigo-400 bg-indigo-500/20 text-white font-bold"
                  : "border-zinc-800 bg-[#09090b] text-zinc-400 hover:border-zinc-700"
              }`}
            >
              All Team Members
            </button>
            {teamCallers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCallerId(c.id)}
                className={`px-3 py-1 rounded-lg border text-xs font-medium transition ${
                  selectedCallerId === c.id
                    ? "border-indigo-400 bg-indigo-500/20 text-white font-bold"
                    : "border-zinc-800 bg-[#09090b] text-zinc-400 hover:border-zinc-700"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="text-[11px] text-zinc-400">
            Analyzing <strong className="text-white">{funnelData.totalLeads}</strong> active CRM leads &bull;{" "}
            <strong className="text-white">{funnelData.totalCallsLogged}</strong> call attempts
          </div>
        </div>
      </div>

      {/* 2. Top Funnel KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="rounded-xl border border-zinc-800/80 bg-[#121215] p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>Calls Logged</span>
            <PhoneCall className="w-4 h-4 text-zinc-500" />
          </div>
          <div className="text-2xl font-black text-white mt-1">{funnelData.totalCallsLogged}</div>
          <div className="text-[11px] text-zinc-400 mt-1">
            Across {funnelData.leadsWithCalls} leads dialed
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-[#121215] p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>Pick / Answer Rate</span>
            <PhoneForwarded className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-black text-sky-300 mt-1">{funnelData.pickRate}%</div>
          <div className="text-[11px] text-zinc-400 mt-1">
            {funnelData.noAnswerCount} rang out ({funnelData.totalCallsLogged > 0 ? Math.round((funnelData.noAnswerCount / funnelData.totalCallsLogged) * 100) : 0}% no-answer)
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-[#121215] p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>Gatekeeper Bypass</span>
            <ShieldAlert className="w-4 h-4 text-orange-400" />
          </div>
          <div className="text-2xl font-black text-orange-300 mt-1">{funnelData.gatekeeperBypassRate}%</div>
          <div className="text-[11px] text-zinc-400 mt-1">
            {funnelData.gatekeeperBlocked} blocked at front desk
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-[#121215] p-4">
          <div className="flex items-center justify-between text-zinc-400 text-xs">
            <span>Decision Maker Spoke</span>
            <Target className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-indigo-300 mt-1">{funnelData.connectedSpoke}</div>
          <div className="text-[11px] text-zinc-400 mt-1">
            {funnelData.followUpsCount} active follow-ups set
          </div>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-4">
          <div className="flex items-center justify-between text-emerald-300 text-xs font-semibold">
            <span>Meetings Booked</span>
            <CalendarCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1">{funnelData.meetingsBooked}</div>
          <div className="text-[11px] text-emerald-300/80 mt-1 font-medium">
            {funnelData.spokeConversionRate}% spoke-to-booking rate
          </div>
        </div>
      </div>

      {/* 3. Visual Funnel Progression Flow */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-400" />
              <span>Full Sales Funnel Progression</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Live step-by-step pipeline conversion showing exactly where prospects move or drop out.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Stage 1: Dispatched Leads */}
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-zinc-300 mb-1.5">
              <span className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-200 flex items-center justify-center text-[10px] font-bold">1</span>
                <span>Active Leads In Outbound Pool</span>
              </span>
              <span className="text-white font-bold">{funnelData.totalLeads} leads (100%)</span>
            </div>
            <div className="w-full h-5 rounded-lg bg-zinc-900 overflow-hidden border border-zinc-800 flex">
              <div className="h-full bg-zinc-600 transition-all duration-500" style={{ width: "100%" }} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1">
              <span>{funnelData.leadsWithCalls} leads dialed at least once</span>
              <span className="text-amber-400">{funnelData.untouchedLeads} fresh untouched leads</span>
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
                {funnelData.totalCallsLogged - funnelData.noAnswerCount} of {funnelData.totalCallsLogged} calls ({funnelData.pickRate}%)
              </span>
            </div>
            <div className="w-full h-5 rounded-lg bg-zinc-900 overflow-hidden border border-zinc-800 flex">
              <div
                className="h-full bg-sky-500 transition-all duration-500"
                style={{ width: `${Math.max(5, funnelData.pickRate)}%` }}
              />
              <div
                className="h-full bg-amber-500/40 transition-all duration-500"
                style={{ width: `${Math.max(0, 100 - funnelData.pickRate)}%` }}
                title={`${funnelData.noAnswerCount} No-Answer (Rang out)`}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1">
              <span className="text-sky-400">Answered by human or IVR</span>
              <span className="text-amber-400">{funnelData.noAnswerCount} No Answer / Rang out</span>
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
                {funnelData.connectedSpoke + funnelData.meetingsBooked} reached DM ({funnelData.gatekeeperBypassRate}% bypass)
              </span>
            </div>
            <div className="w-full h-5 rounded-lg bg-zinc-900 overflow-hidden border border-zinc-800 flex">
              <div
                className="h-full bg-indigo-500 transition-all duration-500"
                style={{ width: `${Math.max(5, funnelData.gatekeeperBypassRate)}%` }}
              />
              <div
                className="h-full bg-orange-500/40 transition-all duration-500"
                style={{ width: `${Math.max(0, 100 - funnelData.gatekeeperBypassRate)}%` }}
                title={`${funnelData.gatekeeperBlocked} Gatekeeper Blocked`}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1">
              <span className="text-indigo-400">Decision maker reached</span>
              <span className="text-orange-400">{funnelData.gatekeeperBlocked} blocked by assistant/gatekeeper</span>
            </div>
          </div>

          {/* Stage 4: Meeting Booked */}
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-zinc-300 mb-1.5">
              <span className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-300 flex items-center justify-center text-[10px] font-bold">4</span>
                <span>Meetings &amp; Appointments Booked</span>
              </span>
              <span className="text-emerald-400 font-bold">
                {funnelData.meetingsBooked} booked ({funnelData.spokeConversionRate}% of spoke)
              </span>
            </div>
            <div className="w-full h-5 rounded-lg bg-zinc-900 overflow-hidden border border-zinc-800 flex">
              <div
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${Math.max(3, funnelData.spokeConversionRate)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1">
              <span className="text-emerald-400 font-semibold">{funnelData.meetingsBooked} qualified meetings booked</span>
              <span className="text-indigo-300">{funnelData.followUpsCount} in active follow-up pipeline</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Automated Bottleneck Diagnostic & Strategic Recommendations */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-amber-400" />
              <span>Funnel Diagnostic &amp; Actionable Coaching</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Algorithmic assessment of where your cold calling funnel is leaking and exact steps to improve conversion.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Dialing Health */}
          <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-zinc-200">1. Dialing &amp; Pick Rate Health</span>
                {funnelData.pickRate >= 40 ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Healthy</span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">Friction</span>
                )}
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {funnelData.pickRate >= 40
                  ? `Your pick rate of ${funnelData.pickRate}% is strong for outbound B2B. Phone numbers and calling hours are effective.`
                  : `Pick rate is ${funnelData.pickRate}% (${funnelData.noAnswerCount} no-answers). Shift calling blocks to 8:30-10:00 AM or 4:00-5:30 PM local prospect time.`}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-zinc-800/80">
              <Link
                href="/caller"
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1"
              >
                <span>Filter No-Answer Leads in CRM</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Card 2: Gatekeeper Friction */}
          <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-zinc-200">2. Gatekeeper Resistance</span>
                {funnelData.gatekeeperBypassRate >= 65 ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Optimal</span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30">Bottleneck</span>
                )}
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {funnelData.gatekeeperBypassRate >= 65
                  ? `Callers are bypassing front desk assistants smoothly (${funnelData.gatekeeperBypassRate}% bypass rate).`
                  : `${funnelData.gatekeeperBlocked} calls were stopped by gatekeepers. Coach callers to ask for Decision Maker casually by first name: "Hey, is [Name] around?"`}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-zinc-800/80">
              <Link
                href="/caller"
                className="text-xs text-orange-400 hover:text-orange-300 font-semibold flex items-center gap-1"
              >
                <span>Filter Gatekeeper Leads in CRM</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Card 3: Pitch & Closing */}
          <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-bold text-zinc-200">3. Pitch &amp; Demo Conversion</span>
                {funnelData.spokeConversionRate >= 15 ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">High Converting</span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Needs Polish</span>
                )}
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {funnelData.spokeConversionRate >= 15
                  ? `Excellent conversion: ${funnelData.spokeConversionRate}% of spoken conversations converted into scheduled demos.`
                  : `Conversion is ${funnelData.spokeConversionRate}%. Ensure callers use the 15-second opening hook and ask for a low-friction 10-minute preview rather than a long pitch.`}
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-zinc-800/80">
              <Link
                href="/caller"
                className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1"
              >
                <span>View Booked Meetings in CRM</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Team Caller Performance Leaderboard */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] overflow-hidden shadow-sm">
        <div className="p-6 border-b border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400" />
              <span>Caller Leaderboard &amp; Team Breakdown</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Side-by-side comparison of dials, connection rates, gatekeeper drop-offs, and booked demos per caller.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#09090b] text-[11px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
              <tr>
                <th className="px-5 py-3">Caller Name</th>
                <th className="px-4 py-3">Assigned Leads</th>
                <th className="px-4 py-3">Calls Made</th>
                <th className="px-4 py-3">Connected / Spoke</th>
                <th className="px-4 py-3">Gatekeeper Blocked</th>
                <th className="px-4 py-3">No Answer</th>
                <th className="px-4 py-3">Bookings</th>
                <th className="px-4 py-3 text-right">Spoke &rarr; Booked %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-medium">
              {funnelData.callerMatrix.map((c) => {
                const convRate =
                  c.connected + c.meetings > 0
                    ? Math.round((c.meetings / (c.connected + c.meetings)) * 100)
                    : 0;

                return (
                  <tr key={c.id} className="hover:bg-zinc-900/60 transition">
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="font-bold text-white flex items-center gap-2">
                        <span>{c.name}</span>
                        {c.meetings >= 3 && (
                          <span className="p-0.5 rounded bg-amber-500/20 text-amber-300" title="Top Producer">
                            <Award className="w-3.5 h-3.5" />
                          </span>
                        )}
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
                      {c.noAnswer} ({c.callsLogged > 0 ? Math.round((c.noAnswer / c.callsLogged) * 100) : 0}%)
                    </td>
                    <td className="px-4 py-3.5 font-black text-emerald-400 text-sm">
                      {c.meetings} Booked
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-white">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${
                          convRate >= 20
                            ? "bg-emerald-500/20 text-emerald-300 font-extrabold"
                            : convRate > 0
                            ? "bg-indigo-500/20 text-indigo-300"
                            : "text-zinc-500"
                        }`}
                      >
                        {convRate}%
                      </span>
                    </td>
                  </tr>
                );
              })}

              {funnelData.callerMatrix.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-zinc-500">
                    No callers found in this workspace. Add callers in Team &amp; Settings.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
