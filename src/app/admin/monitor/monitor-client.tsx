"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminMonitorMetrics } from "@/server/repo/activities";
import type { TeamMember } from "@/server/domain/team";
import { updateMeetingOutcomeAction } from "@/app/caller/actions";
import {
  AlertTriangle,
  Clock,
  UserX,
  Calendar,
  Phone,
  Mail,
  ArrowUpRight,
  RefreshCw,
  Search,
  CheckCircle2,
  Flame,
  Building2,
  Users,
  ChevronRight,
  Filter,
  Video,
  ExternalLink,
  Loader2,
  ShieldAlert,
} from "lucide-react";

interface MonitorClientProps {
  initialMetrics: AdminMonitorMetrics;
  marketName: string;
  activeMember?: TeamMember;
  allMembers?: TeamMember[];
}

export function MonitorClient({
  initialMetrics,
  marketName,
  activeMember,
  allMembers = [],
}: MonitorClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<"overdue" | "unassigned" | "stale" | "meetings">("overdue");
  const [callerFilter, setCallerFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const handleUpdateMeeting = (meetingId: string, status: "ATTENDED" | "NO_SHOW") => {
    startTransition(async () => {
      await updateMeetingOutcomeAction({
        meetingId,
        status,
        outcome: status === "ATTENDED" ? "QUALIFIED" : null,
        actor: activeMember?.name || "Admin",
      });
      router.refresh();
    });
  };

  const metrics = initialMetrics;

  // Filter overdue tasks by caller & search
  const filteredOverdue = metrics.overdueTasks.filter((t) => {
    if (callerFilter !== "ALL" && (t.assignedMemberId || "unassigned") !== callerFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = t.companyName.toLowerCase().includes(q);
      const matchCaller = (t.assignedMemberName || "").toLowerCase().includes(q);
      const matchPhone = (t.phoneDisplay || "").toLowerCase().includes(q);
      return matchName || matchCaller || matchPhone;
    }
    return true;
  });

  // Filter unassigned leads
  const filteredUnassigned = metrics.unassignedApprovedLeads.filter((l) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return l.name.toLowerCase().includes(q) || (l.phoneDisplay || "").includes(q);
  });

  // Filter stale leads
  const filteredStale = metrics.staleActiveLeads.filter((l) => {
    if (callerFilter !== "ALL" && (l.assignedMemberName || "unassigned") !== callerFilter) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return l.name.toLowerCase().includes(q) || (l.phoneDisplay || "").includes(q);
  });

  // Filter upcoming meetings
  const filteredMeetings = metrics.upcomingMeetings.filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return m.companyName.toLowerCase().includes(q) || (m.assignedMemberName || "").toLowerCase().includes(q);
  });

  const pipelineStages = [
    { key: "APPROVED", label: "Approved Queue", color: "text-sky-400 bg-sky-950/40 border-sky-800/60" },
    { key: "CALLING", label: "Calling", color: "text-indigo-400 bg-indigo-950/40 border-indigo-800/60" },
    { key: "CONNECTED", label: "Connected", color: "text-cyan-400 bg-cyan-950/40 border-cyan-800/60" },
    { key: "PAIN_FOUND", label: "Pain Found", color: "text-amber-400 bg-amber-950/40 border-amber-800/60" },
    { key: "MEETING_BOOKED", label: "Meetings Booked", color: "text-emerald-400 bg-emerald-950/40 border-emerald-800/60" },
    { key: "QUALIFIED", label: "Qualified", color: "text-teal-400 bg-teal-950/40 border-teal-800/60" },
    { key: "NURTURE", label: "Nurture", color: "text-purple-400 bg-purple-950/40 border-purple-800/60" },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-[#09090b] text-zinc-100 p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <Flame className="w-6 h-6 text-amber-400" />
              Sales Operations & Lead Monitor
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800/80 border border-zinc-700 text-zinc-300">
              Admin Control
            </span>
          </div>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Real-time oversight of follow-up accountability, unassigned prospects, and silent leads across {marketName}.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={isPending}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isPending ? "animate-spin text-amber-400" : ""}`} />
            <span>{isPending ? "Refreshing..." : "Refresh Feed"}</span>
          </button>
          {Boolean(metrics.pendingDncCount && metrics.pendingDncCount > 0) && (
            <Link
              href="/exclusions"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 transition-all shadow-sm"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              <span>{metrics.pendingDncCount} DNC Requests</span>
            </Link>
          )}
          <Link
            href="/caller"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 transition-all"
          >
            <span>Open Leads CRM</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Pipeline Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        {pipelineStages.map((stage) => {
          const count = metrics.pipelineCounts[stage.key] || 0;
          return (
            <div
              key={stage.key}
              className={`p-3 rounded-lg border flex flex-col justify-between ${stage.color}`}
            >
              <span className="text-[11px] font-medium opacity-80 uppercase tracking-wider">{stage.label}</span>
              <span className="text-xl font-bold mt-1">{count}</span>
            </div>
          );
        })}
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Overdue Tasks */}
        <button
          onClick={() => setActiveTab("overdue")}
          className={`text-left p-4 rounded-xl border transition-all ${
            activeTab === "overdue"
              ? "bg-rose-950/20 border-rose-500/50 shadow-lg shadow-rose-950/20"
              : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-400 uppercase tracking-wider">Overdue Tasks</span>
            <div className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mt-2">{metrics.totalOverdueCount}</div>
          <p className="text-[11px] text-zinc-400 mt-1">Requires immediate caller dial or email</p>
        </button>

        {/* 2. Unassigned Leads */}
        <button
          onClick={() => setActiveTab("unassigned")}
          className={`text-left p-4 rounded-xl border transition-all ${
            activeTab === "unassigned"
              ? "bg-amber-950/20 border-amber-500/50 shadow-lg shadow-amber-950/20"
              : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Approved Unassigned</span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <UserX className="w-4 h-4 text-amber-400" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mt-2">{metrics.totalUnassignedCount}</div>
          <p className="text-[11px] text-zinc-400 mt-1">Approved leads waiting for caller assignment</p>
        </button>

        {/* 3. Stale Active Leads */}
        <button
          onClick={() => setActiveTab("stale")}
          className={`text-left p-4 rounded-xl border transition-all ${
            activeTab === "stale"
              ? "bg-indigo-950/20 border-indigo-500/50 shadow-lg shadow-indigo-950/20"
              : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Stale Active (7d+)</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Clock className="w-4 h-4 text-indigo-400" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mt-2">{metrics.totalStaleCount}</div>
          <p className="text-[11px] text-zinc-400 mt-1">In active stages with no update in 7+ days</p>
        </button>

        {/* 4. Upcoming Meetings */}
        <button
          onClick={() => setActiveTab("meetings")}
          className={`text-left p-4 rounded-xl border transition-all ${
            activeTab === "meetings"
              ? "bg-emerald-950/20 border-emerald-500/50 shadow-lg shadow-emerald-950/20"
              : "bg-zinc-900/60 border-zinc-800 hover:border-zinc-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Meetings Booked</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mt-2">{metrics.totalMeetingsCount}</div>
          <p className="text-[11px] text-zinc-400 mt-1">Scheduled prospect demo & discovery calls</p>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-zinc-900/70 border border-zinc-800/80 p-3 rounded-xl">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Search company, caller, phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-zinc-950/80 border border-zinc-700/80 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Caller Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-xs text-zinc-400">Caller:</span>
            <select
              value={callerFilter}
              onChange={(e) => setCallerFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-950/80 border border-zinc-700/80 text-xs text-zinc-200 focus:outline-none focus:border-amber-400"
            >
              <option value="ALL">All Callers ({metrics.totalOverdueCount} Overdue)</option>
              {metrics.overdueByCaller.map((c) => (
                <option key={c.memberId} value={c.memberId}>
                  {c.memberName} ({c.count} overdue)
                </option>
              ))}
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Content Panel based on activeTab */}
      <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl overflow-hidden shadow-sm">
        {/* Tab 1: Overdue Follow-Ups */}
        {activeTab === "overdue" && (
          <div className="space-y-4">
            <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  Overdue Activities ({filteredOverdue.length})
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Tasks where the scheduled callback or email due time has already passed.
                </p>
              </div>

              {metrics.overdueByCaller.length > 0 && (
                <div className="hidden md:flex items-center gap-2">
                  {metrics.overdueByCaller.slice(0, 4).map((c) => (
                    <button
                      key={c.memberId}
                      onClick={() => setCallerFilter(c.memberId)}
                      className={`text-[11px] px-2.5 py-1 rounded-md border flex items-center gap-1.5 transition-all ${
                        callerFilter === c.memberId
                          ? "bg-rose-500/20 border-rose-500/40 text-rose-300 font-medium"
                          : "bg-zinc-800/70 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      <span>{c.memberName}:</span>
                      <span className="font-bold text-rose-400">{c.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {filteredOverdue.length === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2 opacity-80" />
                <h3 className="text-sm font-semibold text-zinc-200">Zero Overdue Tasks</h3>
                <p className="text-xs text-zinc-400 mt-1">All scheduled callbacks and activities are up to date.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/60 text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Company</th>
                      <th className="py-2.5 px-4 font-medium">Task Type</th>
                      <th className="py-2.5 px-4 font-medium">Assigned Caller</th>
                      <th className="py-2.5 px-4 font-medium">Due Time</th>
                      <th className="py-2.5 px-4 font-medium">Overdue By</th>
                      <th className="py-2.5 px-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-zinc-200">
                    {filteredOverdue.map((t) => (
                      <tr key={t.id} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-medium text-zinc-100">{t.companyName}</div>
                          <div className="text-[11px] text-zinc-400 flex items-center gap-2 mt-0.5">
                            {t.phoneDisplay && <span>{t.phoneDisplay}</span>}
                            {t.state && <span>• {t.state}</span>}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium ${
                              t.activityType === "EMAIL"
                                ? "bg-amber-500/10 text-amber-300 border border-amber-500/30"
                                : t.activityType === "MEETING_PREP"
                                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                                : "bg-sky-500/10 text-sky-300 border border-sky-500/30"
                            }`}
                          >
                            {t.activityType === "EMAIL" ? (
                              <Mail className="w-3 h-3" />
                            ) : t.activityType === "MEETING_PREP" ? (
                              <Calendar className="w-3 h-3" />
                            ) : (
                              <Phone className="w-3 h-3" />
                            )}
                            {t.activityType}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-zinc-300">
                            {t.assignedMemberName || <span className="text-zinc-500 italic">Unassigned</span>}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-zinc-300">
                          {t.dueAt ? new Date(t.dueAt).toLocaleString() : "—"}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded font-semibold text-[11px] bg-rose-950/60 text-rose-300 border border-rose-800/60">
                            {t.overdueHours < 24
                              ? `${t.overdueHours}h overdue`
                              : `${Math.floor(t.overdueHours / 24)}d overdue`}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Link
                            href={`/caller?companyId=${t.companyId}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors text-[11px] font-medium"
                          >
                            <span>Dial Lead</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Approved Unassigned */}
        {activeTab === "unassigned" && (
          <div className="space-y-4">
            <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <UserX className="w-4 h-4 text-amber-400" />
                  Approved Leads Awaiting Caller Assignment ({filteredUnassigned.length})
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Leads vetted and ready for calling, currently with no caller owner.
                </p>
              </div>
              <Link
                href="/approved"
                className="text-xs font-medium text-amber-400 hover:text-amber-300 flex items-center gap-1"
              >
                <span>Bulk Distribute in Approved</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {filteredUnassigned.length === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2 opacity-80" />
                <h3 className="text-sm font-semibold text-zinc-200">All Approved Leads Assigned</h3>
                <p className="text-xs text-zinc-400 mt-1">There are no approved leads sitting idle without an assigned caller.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/60 text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Company</th>
                      <th className="py-2.5 px-4 font-medium">Location</th>
                      <th className="py-2.5 px-4 font-medium">Phone</th>
                      <th className="py-2.5 px-4 font-medium">Approved At</th>
                      <th className="py-2.5 px-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-zinc-200">
                    {filteredUnassigned.map((l) => (
                      <tr key={l.id} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="py-3 px-4 font-medium text-zinc-100">{l.name}</td>
                        <td className="py-3 px-4 text-zinc-400">{l.state || "—"}</td>
                        <td className="py-3 px-4 text-zinc-300">{l.phoneDisplay || "—"}</td>
                        <td className="py-3 px-4 text-zinc-400">
                          {l.approvedAt ? new Date(l.approvedAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Link
                            href={`/caller?companyId=${l.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-colors text-[11px] font-medium"
                          >
                            <span>Assign in CRM</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Stale Active Leads */}
        {activeTab === "stale" && (
          <div className="space-y-4">
            <div className="p-4 border-b border-zinc-800/80">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                Stale Active Leads ({filteredStale.length})
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Leads in active calling stages that haven’t been touched or called in 7+ days.
              </p>
            </div>

            {filteredStale.length === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2 opacity-80" />
                <h3 className="text-sm font-semibold text-zinc-200">Pipeline Velocity Healthy</h3>
                <p className="text-xs text-zinc-400 mt-1">No active leads are suffering from neglect or inactivity.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/60 text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Company</th>
                      <th className="py-2.5 px-4 font-medium">Pipeline Stage</th>
                      <th className="py-2.5 px-4 font-medium">Caller</th>
                      <th className="py-2.5 px-4 font-medium">Days Silent</th>
                      <th className="py-2.5 px-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-zinc-200">
                    {filteredStale.map((l) => (
                      <tr key={l.id} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="py-3 px-4 font-medium text-zinc-100">{l.name}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-800 border border-zinc-700 text-zinc-300">
                            {l.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-zinc-300">{l.assignedMemberName || "Unassigned"}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded font-semibold text-[11px] bg-amber-950/60 text-amber-300 border border-amber-800/60">
                            {l.daysSilent} days ago
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Link
                            href={`/caller?companyId=${l.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors text-[11px] font-medium"
                          >
                            <span>Resume Contact</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Upcoming Meetings */}
        {activeTab === "meetings" && (
          <div className="space-y-4">
            <div className="p-4 border-b border-zinc-800/80">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                Scheduled Discovery Meetings ({filteredMeetings.length})
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Prospects who agreed to a discovery / demo meeting.
              </p>
            </div>

            {filteredMeetings.length === 0 ? (
              <div className="p-12 text-center">
                <Calendar className="w-10 h-10 text-zinc-600 mx-auto mb-2 opacity-50" />
                <h3 className="text-sm font-semibold text-zinc-200">No Meetings Currently Booked</h3>
                <p className="text-xs text-zinc-400 mt-1">Meetings booked by callers will appear here with scheduled dates and notes.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/60 text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Prospect</th>
                      <th className="py-2.5 px-4 font-medium">Attendee & Channel</th>
                      <th className="py-2.5 px-4 font-medium">Scheduled Date</th>
                      <th className="py-2.5 px-4 font-medium">Prep Notes</th>
                      <th className="py-2.5 px-4 font-medium text-right">Quick Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-zinc-200">
                    {filteredMeetings.map((m) => (
                      <tr key={m.id} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="py-3 px-4 font-medium text-zinc-100">
                          <div>{m.companyName}</div>
                          <div className="text-[11px] text-zinc-400">Caller: {m.assignedMemberName || "—"}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 font-semibold text-[10px]">
                              {m.platform === "PHONE" ? (
                                <Phone className="w-2.5 h-2.5 text-emerald-400" />
                              ) : (
                                <Video className="w-2.5 h-2.5 text-sky-400" />
                              )}
                              <span>{m.platform || "ZOOM"}</span>
                            </span>
                            {m.meetingUrl && (
                              <a
                                href={m.meetingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[10px] font-semibold transition"
                              >
                                <span>Join</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                          </div>
                          {(m.attendeeName || m.attendeeEmail) && (
                            <div className="text-[11px] text-zinc-400 mt-1">
                              {m.attendeeName} {m.attendeeEmail ? `• ${m.attendeeEmail}` : ""}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-emerald-400 font-semibold">
                          {m.scheduledAt ? new Date(m.scheduledAt).toLocaleString() : "Date TBD"}
                        </td>
                        <td className="py-3 px-4 text-zinc-400 max-w-xs truncate">{m.prepNotes || m.notes || "—"}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {m.meetingId && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateMeeting(m.meetingId!, "ATTENDED")}
                                  disabled={isPending}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold transition cursor-pointer"
                                  title="Mark Discovery Attended (moves lead forward)"
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span>Attended</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateMeeting(m.meetingId!, "NO_SHOW")}
                                  disabled={isPending}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[11px] font-semibold transition cursor-pointer"
                                  title="Mark No-Show (auto-schedules recovery call in +4 hours)"
                                >
                                  <UserX className="w-3 h-3 text-rose-400" />
                                  <span>No-Show</span>
                                </button>
                              </>
                            )}
                            <Link
                              href={`/caller?companyId=${m.companyId}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors text-[11px] font-medium"
                            >
                              <span>Open Lead</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
