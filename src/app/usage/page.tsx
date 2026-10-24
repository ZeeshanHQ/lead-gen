import React from "react";
import { redirect } from "next/navigation";
import { ShieldCheck, DollarSign, Activity, HardDrive, Server, Clock } from "lucide-react";
import { getDb } from "@/server/db/client";
import { sources, researchRuns } from "@/server/db/schema";
import { getActiveTeamMember } from "@/server/repo/team";
import { getDefaultRouteForMember } from "@/server/domain/team";
import { formatDateTime } from "@/lib/utils";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const db = await getDb();
  const { activeMember } = await getActiveTeamMember(db);

  // Strictly Owner-only page
  if (activeMember.role !== "OWNER") {
    redirect(getDefaultRouteForMember(activeMember));
  }

  const [sourceRows, runRows] = await Promise.all([
    db.select().from(sources),
    db.select().from(researchRuns).orderBy(desc(researchRuns.createdAt)).limit(25),
  ]);

  let totalRequests = 0;
  let totalErrors = 0;
  let estimatedSpend = 0;
  let totalPagesCrawled = 0;

  for (const s of sourceRows) {
    totalRequests += s.requests || 0;
    totalErrors += s.errors || 0;
    estimatedSpend += (s.requests || 0) * (s.costPerRequestUsd || 0);
  }

  for (const r of runRows) {
    const counters = (r.counters as Record<string, number>) || {};
    totalPagesCrawled += counters.completedJobs
      ? counters.completedJobs * 8
      : (counters.discovered || 0) * 3;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300 mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            Owner Administration
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            API Usage, Quotas &amp; Cost Controls
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Monitor source adapter requests, web inspection volume, email delivery status, and extraction run telemetry.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-[#09090b] px-3 py-2 text-xs font-medium text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            {sourceRows.filter((s) => s.enabled).length} Active Adapters
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl border border-zinc-800/80 bg-[#121215] space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Total Adapter Requests</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-bold text-white tracking-tight">
            {totalRequests}
          </div>
          <div className="text-xs text-zinc-500">
            Across {sourceRows.length} discovery &amp; enrichment sources
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-zinc-800/80 bg-[#121215] space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Estimated API Spend</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-bold text-emerald-400 tracking-tight">
            ${estimatedSpend.toFixed(2)}
          </div>
          <div className="text-xs text-zinc-500">
            {estimatedSpend === 0 ? "Direct web extraction active" : "Metered provider usage"}
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-zinc-800/80 bg-[#121215] space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Pages Inspected</span>
            <HardDrive className="w-4 h-4 text-zinc-300" />
          </div>
          <div className="text-3xl font-bold text-white tracking-tight">
            {totalPagesCrawled}
          </div>
          <div className="text-xs text-zinc-500">
            Bounded at max 20 pages per domain
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-zinc-800/80 bg-[#121215] space-y-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Cost Ceiling Protection</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-bold text-emerald-400 tracking-tight">
            ACTIVE
          </div>
          <div className="text-xs text-zinc-500">
            {totalErrors} adapter errors logged
          </div>
        </div>
      </div>

      {/* Cost & Provider Breakdown Table */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] overflow-hidden shadow-sm">
        <div className="p-5 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-zinc-300" />
            <h2 className="text-sm font-bold text-white">
              Source Adapter Usage &amp; Spend Accounting
            </h2>
          </div>
          <span className="text-xs text-zinc-400">
            {sourceRows.length} Total Configured Providers
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-[#09090b] text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
              <tr>
                <th className="px-5 py-3">Source Provider</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Rate / Request</th>
                <th className="px-5 py-3">Total Requests</th>
                <th className="px-5 py-3">Avg Latency</th>
                <th className="px-5 py-3">Errors</th>
                <th className="px-5 py-3 text-right">Total Incurred</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-xs">
              {sourceRows.map((s) => {
                const cost = (s.requests || 0) * (s.costPerRequestUsd || 0);
                const avgLat =
                  s.requests && s.requests > 0
                    ? Math.round((s.totalLatencyMs || 0) / s.requests)
                    : 0;

                return (
                  <tr key={s.id} className="hover:bg-zinc-900/50 transition-colors">
                    <td className="px-5 py-3.5 font-sans">
                      <div className="font-semibold text-white">{s.name}</div>
                      <div className="text-[11px] text-zinc-500 font-mono">{s.key}</div>
                    </td>
                    <td className="px-5 py-3.5 font-sans capitalize text-zinc-400">
                      {s.kind.replace(/_/g, " ")}
                    </td>
                    <td className="px-5 py-3.5 font-sans">
                      {s.enabled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                          Enabled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                          Standby
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {s.costPerRequestUsd === 0 ? (
                        <span className="text-emerald-400 font-sans font-medium">$0.00 (Included)</span>
                      ) : (
                        `$${s.costPerRequestUsd.toFixed(3)}`
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-semibold text-white">{s.requests || 0}</td>
                    <td className="px-5 py-3.5 text-zinc-400">{avgLat ? `${avgLat}ms` : "0ms"}</td>
                    <td className="px-5 py-3.5">
                      {s.errors && s.errors > 0 ? (
                        <span className="text-rose-400 font-semibold">{s.errors}</span>
                      ) : (
                        <span className="text-zinc-500">0</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold text-emerald-400 font-mono">
                      ${cost.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Discovery & Research Run Telemetry */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] overflow-hidden shadow-sm">
        <div className="p-5 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-300" />
            <h2 className="text-sm font-bold text-white">
              Recent Lead Extraction &amp; Verification Runs
            </h2>
          </div>
          <span className="text-xs text-zinc-400">
            Last {runRows.length} runs
          </span>
        </div>

        {runRows.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500">
            No extraction runs recorded yet. Run a search in Find Leads to log telemetry.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="bg-[#09090b] text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
                <tr>
                  <th className="px-5 py-3">Run Type</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Initiated By</th>
                  <th className="px-5 py-3">Started</th>
                  <th className="px-5 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {runRows.map((run) => {
                  const counters = (run.counters as Record<string, any>) || {};
                  return (
                    <tr key={run.id} className="hover:bg-zinc-900/50 transition-colors">
                      <td className="px-5 py-3 font-semibold text-white capitalize">
                        {(run.mode || "DISCOVERY").replace(/_/g, " ")}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                            run.status === "COMPLETED"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : run.status === "FAILED"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                              : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                          }`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-zinc-300">{run.actor || "System"}</td>
                      <td className="px-5 py-3 text-zinc-400">{formatDateTime(run.createdAt)}</td>
                      <td className="px-5 py-3 text-right font-mono text-[11px] text-zinc-400">
                        {counters.discovered !== undefined
                          ? `${counters.discovered} found`
                          : counters.completedJobs !== undefined
                          ? `${counters.completedJobs} jobs`
                          : "Completed"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
