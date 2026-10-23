import React from "react";
import Link from "next/link";
import { getDb } from "@/server/db/client";
import { getOverview } from "@/server/repo/detail";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { getSetting } from "@/server/repo/settings";
import { DEFAULT_DIALER_CONFIG, type DialerConfig } from "@/server/domain/dialer";
import { ROLE_PRESETS } from "@/server/domain/team";
import { loadLeadRows } from "@/server/repo/queue";
import { factValue } from "@/server/domain/facts";
import { formatDateTime } from "@/lib/utils";
import {
  Compass,
  Inbox,
  PhoneCall,
  SlidersHorizontal,
  Users,
  ArrowRight,
  CheckCircle2,
  Building2,
  Sparkles,
  Phone,
  ExternalLink,
  ShieldCheck,
  Zap,
  Activity,
  ChevronRight,
  Filter,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const db = await getDb();
  const ctx = await getActiveContext(db);
  const { market, tenant, rule: defaultRule } = ctx;
  const { activeMember, allMembers } = await getActiveTeamMember(db);
  const savedDialer = await getSetting<Partial<DialerConfig>>(
    db,
    "dialer_config"
  );
  const dialerConfig: DialerConfig = {
    ...DEFAULT_DIALER_CONFIG,
    ...(savedDialer || {}),
  };

  const overview = await getOverview(db, market.id);
  const approvedRows = await loadLeadRows(db, "approved", market.id);
  const reviewRows = await loadLeadRows(db, "review", market.id);

  const needsReview = overview.byStatus["NEEDS_REVIEW"] ?? 0;
  const discovered = overview.byStatus["DISCOVERED"] ?? 0;
  const approved = overview.byStatus["APPROVED"] ?? 0;
  const inPipeline =
    (overview.byStatus["CALLING"] ?? 0) +
    (overview.byStatus["CONNECTED"] ?? 0) +
    (overview.byStatus["PAIN_FOUND"] ?? 0) +
    (overview.byStatus["MEETING_BOOKED"] ?? 0) +
    (overview.byStatus["QUALIFIED"] ?? 0);

  const perms = activeMember.permissions;
  const nicheMembers = allMembers.filter(
    (m) =>
      m.status !== "SUSPENDED" &&
      (m.nicheScope === "ALL" ||
        m.allowedNicheIds.length === 0 ||
        m.allowedNicheIds.includes(market.id))
  );

  // Top Priority Leads (High-score leads awaiting review or approved for calling)
  const priorityLeads = [...approvedRows, ...reviewRows]
    .sort((a, b) => (b.icpScore ?? 0) - (a.icpScore ?? 0))
    .slice(0, 6);

  // Conversion Funnel Totals
  const totalInPipeline = overview.total || 0;
  const pctReview = totalInPipeline > 0 ? Math.round(((needsReview + discovered) / totalInPipeline) * 100) : 0;
  const pctApproved = totalInPipeline > 0 ? Math.round((approved / totalInPipeline) * 100) : 0;
  const pctCalling = totalInPipeline > 0 ? Math.round((inPipeline / totalInPipeline) * 100) : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. Executive Hero Header */}
      <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-b from-slate-900/60 to-slate-900/20 p-6 sm:p-7 backdrop-blur-sm shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-medium text-slate-300">{tenant.name}</span>
              <span>/</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-950 px-2.5 py-0.5 font-medium text-slate-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {market.name}
              </span>
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {market.name}
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              {market.description ||
                `Targeting qualified contractors, verifying decision makers, and driving outbound conversions.`}
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            {perms.discoverLeads && (
              <Link
                href="/discover"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-slate-200 shadow-sm"
              >
                <Compass className="w-4 h-4 text-slate-950" />
                <span>Find Leads</span>
              </Link>
            )}

            {perms.approveLeads && (
              <Link
                href="/review"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800/90 px-4 py-2.5 text-xs font-medium text-slate-100 transition hover:bg-slate-800 hover:text-white"
              >
                <Inbox className="w-4 h-4 text-sky-400" />
                <span>Review Queue</span>
                {needsReview + discovered > 0 && (
                  <span className="rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 text-[11px] font-semibold">
                    {needsReview + discovered}
                  </span>
                )}
              </Link>
            )}

            {perms.callerWorkbench && (
              <Link
                href="/caller"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-800/90 px-4 py-2.5 text-xs font-medium text-slate-100 transition hover:bg-slate-800 hover:text-white"
              >
                <PhoneCall className="w-4 h-4 text-emerald-400" />
                <span>Caller Queue</span>
                {approved + inPipeline > 0 && (
                  <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-semibold">
                    {approved + inPipeline}
                  </span>
                )}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* 2. Key Performance Indicators (Clean 4-Card Grid) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Leads */}
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 transition hover:border-slate-700/80">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total Leads</span>
            <Building2 className="w-4 h-4 text-slate-500" />
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-white">
            {overview.total}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
            <span>{overview.contactTotal} contacts saved</span>
            <span className="text-[11px] text-slate-400">{market.name}</span>
          </div>
        </div>

        {/* Card 2: Needs Review */}
        <Link
          href="/review"
          className="group rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 transition hover:border-sky-500/40 hover:bg-slate-900/60"
        >
          <div className="flex items-center justify-between text-xs text-slate-400 group-hover:text-sky-300">
            <span>Needs Review</span>
            <Inbox className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-white group-hover:text-sky-100">
            {needsReview + discovered}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>Pending qualification</span>
            <span className="text-sky-400 flex items-center gap-0.5 text-[11px] font-medium group-hover:underline">
              Open Queue <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </Link>

        {/* Card 3: Approved & Qualified */}
        <Link
          href="/approved"
          className="group rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 transition hover:border-emerald-500/40 hover:bg-slate-900/60"
        >
          <div className="flex items-center justify-between text-xs text-slate-400 group-hover:text-emerald-300">
            <span>Approved Leads</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-white group-hover:text-emerald-100">
            {approved}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>Ready for outreach</span>
            <span className="text-emerald-400 flex items-center gap-0.5 text-[11px] font-medium group-hover:underline">
              View Sheet <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </Link>

        {/* Card 4: Calling Pipeline */}
        <Link
          href="/caller"
          className="group rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 transition hover:border-amber-500/40 hover:bg-slate-900/60"
        >
          <div className="flex items-center justify-between text-xs text-slate-400 group-hover:text-amber-300">
            <span>Active in Pipeline</span>
            <PhoneCall className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-white group-hover:text-amber-100">
            {inPipeline}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
            <span>Calls &amp; meetings</span>
            <span className="text-amber-400 flex items-center gap-0.5 text-[11px] font-medium group-hover:underline">
              Dialer Queue <ChevronRight className="w-3 h-3" />
            </span>
          </div>
        </Link>
      </div>

      {/* 3. Pipeline Funnel Progress Bar */}
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/30 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-slate-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Pipeline Stage Breakdown
            </h2>
          </div>
          <div className="text-xs text-slate-400">
            {totalInPipeline} Total Tracked Opportunities
          </div>
        </div>

        {/* Progress Strip */}
        <div className="h-2.5 w-full rounded-full bg-slate-800/80 overflow-hidden flex">
          <div
            style={{ width: `${pctReview}%` }}
            className="bg-sky-500 transition-all"
            title={`Review Queue: ${needsReview + discovered} (${pctReview}%)`}
          />
          <div
            style={{ width: `${pctApproved}%` }}
            className="bg-emerald-500 transition-all"
            title={`Approved: ${approved} (${pctApproved}%)`}
          />
          <div
            style={{ width: `${pctCalling}%` }}
            className="bg-amber-500 transition-all"
            title={`In Pipeline: ${inPipeline} (${pctCalling}%)`}
          />
        </div>

        {/* Funnel Stage Labels */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-sky-500 shrink-0" />
            <span className="text-slate-400">Under Review:</span>
            <span className="font-medium text-white">{needsReview + discovered}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-slate-400">Approved:</span>
            <span className="font-medium text-white">{approved}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
            <span className="text-slate-400">In Pipeline:</span>
            <span className="font-medium text-white">{inPipeline}</span>
          </div>
        </div>
      </div>

      {/* 4. Main Two-Column Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left (66%): Priority Leads Card */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 sm:p-6">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  High-Priority Leads
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Top-scoring opportunities ready for immediate qualification or call.
                </p>
              </div>

              {approvedRows.length > 0 && (
                <Link
                  href="/approved"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300"
                >
                  <span>View All Leads ({approvedRows.length})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>

            {priorityLeads.length === 0 ? (
              <div className="py-12 text-center">
                <Building2 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-sm font-medium text-slate-300">
                  No Leads Discovered Yet
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                  Prospect new {market.name} companies using live search, Google Places, or upload a CSV.
                </p>
                <Link
                  href="/discover"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-slate-200 transition"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Start Lead Discovery</span>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60 mt-2">
                {priorityLeads.map((lead) => {
                  const score = lead.icpScore ?? 0;
                  const replacement = factValue(lead.facts, "replacement");
                  const financing = factValue(lead.facts, "financing");
                  const contact = lead.best?.name || lead.owner?.name;
                  const phone = lead.best?.phone || lead.phoneDisplay;

                  return (
                    <div
                      key={lead.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-900/50 -mx-2 px-2 rounded-xl transition"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/company/${lead.id}`}
                            className="font-medium text-sm text-white hover:text-sky-400 transition truncate"
                          >
                            {lead.name}
                          </Link>
                          {score > 0 && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                                score >= 75
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : score >= 50
                                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                  : "bg-slate-800 text-slate-400 border-slate-700"
                              }`}
                            >
                              ICP {score}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                          {(lead.city || lead.state) && (
                            <span>{[lead.city, lead.state].filter(Boolean).join(", ")}</span>
                          )}
                          {contact && (
                            <span>• {contact}</span>
                          )}
                          {phone && (
                            <span className="font-mono text-slate-300">{phone}</span>
                          )}
                        </div>

                        {/* Signals */}
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {replacement === "YES" && (
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 font-medium">
                              Replacement: Yes
                            </span>
                          )}
                          {financing === "YES" && (
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-emerald-300 font-medium">
                              Financing: Yes
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/company/${lead.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition"
                        >
                          <span>Review</span>
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

        {/* Right (33%): Niche Intelligence & Recent Audit Activity */}
        <div className="space-y-5">
          {/* Niche Qualification Criteria Card */}
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">
                  Qualification Rules
                </h3>
              </div>
              {perms.editRules && (
                <Link
                  href="/rules"
                  className="text-xs text-slate-400 hover:text-white transition"
                >
                  Edit &rarr;
                </Link>
              )}
            </div>

            <div className="mt-3.5 space-y-3 text-xs">
              <div className="flex items-center justify-between rounded-lg bg-slate-950/60 p-2.5 border border-slate-800">
                <span className="text-slate-400">Min ICP Approval Score:</span>
                <span className="font-semibold text-white">{defaultRule?.config?.scoring?.minScore ?? 60} / 100</span>
              </div>

              <div className="space-y-2 pt-1 text-slate-300">
                <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Target Niche Signals &amp; Keywords
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(market.keywords && market.keywords.length > 0
                    ? market.keywords.slice(0, 6)
                    : ["Verified Phone", "Decision Maker", "Target Services"]
                  ).map((kw, i) => (
                    <span
                      key={i}
                      className="rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-300 capitalize"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity Audit Stream */}
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
              </div>
              <Link href="/audit" className="text-xs text-slate-400 hover:text-white transition">
                Full Log &rarr;
              </Link>
            </div>

            {overview.recent.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                No activity logged yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60 mt-2 text-xs">
                {overview.recent.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-300 border border-slate-800">
                        {entry.action}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      By <span className="text-slate-300">{entry.actor}</span>
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
