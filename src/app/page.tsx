import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getOverview } from "@/server/repo/detail";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { loadLeadRows } from "@/server/repo/queue";
import { resolveGate } from "@/server/domain/gate";
import { formatDateTime } from "@/lib/utils";
import {
  Compass,
  PhoneCall,
  ArrowRight,
  CheckCircle2,
  Building2,
  ShieldCheck,
  Activity,
  ChevronRight,
  Calendar,
  UserCheck,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const db = await getDb();
  const [ctx, { activeMember }] = await Promise.all([
    getActiveContext(db),
    getActiveTeamMember(db),
  ]);

  if (!canMemberAccessPath(activeMember, "/")) {
    redirect(getDefaultRouteForMember(activeMember));
  }

  const { market, tenant, rule: defaultRule } = ctx;
  const activeGate = resolveGate((defaultRule?.config as any)?.gate);

  const [overview, approvedRows] = await Promise.all([
    getOverview(db, market.id),
    loadLeadRows(db, "approved", market.id),
  ]);

  const isOwnerOrManager =
    activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);

  // Filter approved rows by the active Must-Have Gate AND by member assignment if not Owner/Manager
  const qualifiedRows = approvedRows.filter((l) => {
    if (!isOwnerOrManager && l.assignedMemberId !== activeMember.id) {
      return false;
    }
    if (activeGate.requirePhone) {
      const phone = l.best?.phone || l.phoneDisplay || "";
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 10) return false;
    }
    return true;
  });

  const readyToCall = qualifiedRows.filter((l) =>
    ["APPROVED", "SYNCED", "CALLING"].includes(l.status)
  ).length;
  const connected = qualifiedRows.filter((l) =>
    ["CONNECTED", "PAIN_FOUND", "QUALIFIED"].includes(l.status)
  ).length;
  const meetingsBooked = qualifiedRows.filter((l) => l.status === "MEETING_BOOKED").length;
  const followUpsCount = qualifiedRows.filter(
    (l) => l.notes && l.notes.includes("Follow-up Scheduled")
  ).length;

  const perms = activeMember.permissions;
  const priorityLeads = qualifiedRows
    .sort((a, b) => (b.icpScore ?? 0) - (a.icpScore ?? 0))
    .slice(0, 6);

  const recentEntries = isOwnerOrManager
    ? overview.recent
    : overview.recent.filter(
        (entry) =>
          entry.actor?.toLowerCase() === activeMember.name?.toLowerCase() ||
          entry.actor?.toLowerCase() === activeMember.email?.toLowerCase()
      );

  const totalCrm = qualifiedRows.length;
  const pctReady = totalCrm > 0 ? Math.round((readyToCall / totalCrm) * 100) : 0;
  const pctConnected = totalCrm > 0 ? Math.round((connected / totalCrm) * 100) : 0;
  const pctMeetings = totalCrm > 0 ? Math.round((meetingsBooked / totalCrm) * 100) : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. Executive Hero Header */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-6 sm:p-7 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="font-medium text-zinc-300">{tenant.name}</span>
              <span>/</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-[#09090b] px-2.5 py-0.5 font-medium text-zinc-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {market.name}
              </span>
              {!isOwnerOrManager && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-medium text-emerald-300">
                  <UserCheck className="h-3 w-3" />
                  My Assigned Queue ({activeMember.name})
                </span>
              )}
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {market.name}
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              {isOwnerOrManager
                ? market.description ||
                  `Verified ${market.name} lead extraction, Must-Have Quality Gate enforcement, and cold-calling CRM pipeline.`
                : `Your assigned ${market.name} calling queue, scheduled callbacks, and booked meetings.`}
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            {perms.discoverLeads && (
              <Link
                href="/discover"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-black transition hover:bg-zinc-200 shadow-sm"
              >
                <Compass className="w-4 h-4 text-black" />
                <span>Find Leads</span>
              </Link>
            )}

            {perms.callerWorkbench && (
              <Link
                href="/caller"
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-800 hover:text-white"
              >
                <PhoneCall className="w-4 h-4 text-emerald-400" />
                <span>Open Leads CRM</span>
                {totalCrm > 0 && (
                  <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-bold">
                    {totalCrm}
                  </span>
                )}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* 2. Key Performance Indicators (Clean 4-Card Grid) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/caller"
          className="group rounded-2xl border border-zinc-800/80 bg-[#121215] p-5 transition hover:border-zinc-700"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>{isOwnerOrManager ? "Verified Leads in CRM" : "My Assigned Leads"}</span>
            <Building2 className="w-4 h-4 text-zinc-500" />
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-white">
            {totalCrm}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
            <span>{isOwnerOrManager ? "Passed Must-Have Gate" : "Assigned to your queue"}</span>
            <span className="text-zinc-300 flex items-center gap-0.5 text-[11px] font-medium group-hover:underline">
              Open CRM <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </Link>

        <Link
          href="/caller"
          className="group rounded-2xl border border-zinc-800/80 bg-[#121215] p-5 transition hover:border-emerald-500/40"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400 group-hover:text-emerald-300">
            <span>Ready to Call</span>
            <PhoneCall className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-white">
            {readyToCall}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
            <span>Dialable phone numbers</span>
            <span className="text-emerald-400 flex items-center gap-0.5 text-[11px] font-medium group-hover:underline">
              Start Calling <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </Link>

        <Link
          href="/caller"
          className="group rounded-2xl border border-zinc-800/80 bg-[#121215] p-5 transition hover:border-amber-500/40"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400 group-hover:text-amber-300">
            <span>Scheduled Follow-Ups</span>
            <Calendar className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-white">
            {followUpsCount}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
            <span>Callbacks &amp; nurture</span>
            <span className="text-amber-400 flex items-center gap-0.5 text-[11px] font-medium group-hover:underline">
              View Follow-Ups <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </Link>

        <Link
          href="/caller"
          className="group rounded-2xl border border-zinc-800/80 bg-[#121215] p-5 transition hover:border-emerald-500/40"
        >
          <div className="flex items-center justify-between text-xs text-zinc-400 group-hover:text-emerald-300">
            <span>Meetings Booked</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-white">
            {meetingsBooked}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
            <span>{connected} connected calls</span>
            <span className="text-emerald-400 flex items-center gap-0.5 text-[11px] font-medium group-hover:underline">
              View Pipeline <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </Link>
      </div>

      {/* 3. Pipeline Funnel Progress Bar */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-zinc-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {isOwnerOrManager ? "CRM Pipeline Breakdown" : "My Calling Pipeline Breakdown"}
            </h2>
          </div>
          <div className="text-xs text-zinc-400">
            {totalCrm} {isOwnerOrManager ? "Active CRM Opportunities" : "Assigned Leads"}
          </div>
        </div>

        <div className="h-2.5 w-full rounded-full bg-zinc-800/80 overflow-hidden flex">
          <div
            style={{ width: `${pctReady}%` }}
            className="bg-zinc-300 transition-all"
            title={`Ready to Call: ${readyToCall} (${pctReady}%)`}
          />
          <div
            style={{ width: `${pctConnected}%` }}
            className="bg-amber-400 transition-all"
            title={`Connected: ${connected} (${pctConnected}%)`}
          />
          <div
            style={{ width: `${pctMeetings}%` }}
            className="bg-emerald-400 transition-all"
            title={`Meetings Booked: ${meetingsBooked} (${pctMeetings}%)`}
          />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-zinc-300 shrink-0" />
            <span className="text-zinc-400">Ready to Call:</span>
            <span className="font-semibold text-white">{readyToCall}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
            <span className="text-zinc-400">Connected:</span>
            <span className="font-semibold text-white">{connected}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-zinc-400">Meetings Booked:</span>
            <span className="font-semibold text-white">{meetingsBooked}</span>
          </div>
        </div>
      </div>

      {/* 4. Main Two-Column Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left (66%): Priority Leads Card */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-5 sm:p-6">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
              <div>
                <h2 className="text-base font-bold text-white">
                  {isOwnerOrManager
                    ? "Top Qualified Leads in CRM"
                    : "My Top Assigned Leads in CRM"}
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {isOwnerOrManager
                    ? "Highest-scoring verified leads ready for immediate outreach."
                    : `Verified leads assigned to ${activeMember.name} for calling and follow-up.`}
                </p>
              </div>

              {totalCrm > 0 && (
                <Link
                  href="/caller"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  <span>Open Full CRM ({totalCrm})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>

            {priorityLeads.length === 0 ? (
              <div className="py-12 text-center">
                <Building2 className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-zinc-300">
                  {isOwnerOrManager
                    ? "No Qualified Leads in CRM Yet"
                    : "No Leads Assigned to Your Queue Yet"}
                </h3>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1 mb-4">
                  {isOwnerOrManager
                    ? `Extract verified ${market.name} companies with dialable phone numbers in 1 click.`
                    : `Import your lead sheet in Leads CRM or ask your Workspace Owner to assign ${market.name} leads to your account.`}
                </p>
                {perms.discoverLeads ? (
                  <Link
                    href="/discover"
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-black hover:bg-zinc-200 transition"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>Find &amp; Qualify Leads</span>
                  </Link>
                ) : (
                  <Link
                    href="/caller"
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-black hover:bg-zinc-200 transition"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    <span>Open My Leads CRM</span>
                  </Link>
                )}
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/60 mt-2">
                {priorityLeads.map((lead) => {
                  const score = lead.icpScore ?? 0;
                  const contact = lead.best?.name || lead.owner?.name;
                  const phone = lead.best?.phone || lead.phoneDisplay;

                  return (
                    <div
                      key={lead.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-zinc-900/50 -mx-2 px-2 rounded-xl transition"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href="/caller"
                            className="font-semibold text-sm text-white hover:underline transition truncate"
                          >
                            {lead.name}
                          </Link>
                          {score > 0 && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                                score >= 75
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : "bg-zinc-800 text-zinc-300 border-zinc-700"
                              }`}
                            >
                              {score}/100
                            </span>
                          )}
                          {isOwnerOrManager && lead.assignedMemberName && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800/90 border border-zinc-700 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                              <UserCheck className="w-2.5 h-2.5 text-emerald-400" />
                              {lead.assignedMemberName}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                          {(lead.city || lead.state) && (
                            <span>{[lead.city, lead.state].filter(Boolean).join(", ")}</span>
                          )}
                          {contact && <span>• {contact}</span>}
                          {phone && (
                            <span className="font-mono text-emerald-400 font-semibold">{phone}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href="/caller"
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-700 hover:text-white transition"
                        >
                          <span>Open in CRM</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right (33%): Niche Intelligence & Recent Activity */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-5">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  Active Quality Gate
                </h3>
              </div>
              {perms.discoverLeads && (
                <Link
                  href="/discover"
                  className="text-xs text-zinc-400 hover:text-white transition"
                >
                  Configure &rarr;
                </Link>
              )}
            </div>

            <div className="mt-3.5 space-y-3 text-xs">
              <div className="flex items-center justify-between rounded-lg bg-[#09090b] p-2.5 border border-zinc-800">
                <span className="text-zinc-400">Min ICP Score:</span>
                <span className="font-bold text-white">{defaultRule?.config?.scoring?.minScore ?? 60} / 100</span>
              </div>

              <div className="space-y-2 pt-1 text-zinc-300">
                <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  Target Keywords
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(market.keywords && market.keywords.length > 0
                    ? market.keywords.slice(0, 6)
                    : [market.name]
                  ).map((kw, i) => (
                    <span
                      key={i}
                      className="rounded-md border border-zinc-800 bg-[#09090b] px-2 py-1 text-[11px] text-zinc-300"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-5">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-zinc-400" />
                <h3 className="text-sm font-bold text-white">
                  {isOwnerOrManager ? "Recent Activity" : "My Recent Activity"}
                </h3>
              </div>
            </div>

            {recentEntries.length === 0 ? (
              <div className="py-6 text-center text-xs text-zinc-500">
                No activity logged yet.
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/60 mt-2 text-xs">
                {recentEntries.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded bg-[#09090b] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 border border-zinc-800">
                        {entry.action}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate">
                      By <span className="text-zinc-300">{entry.actor}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
