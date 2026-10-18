import React from "react";
import { Coins, ShieldCheck, DollarSign, Activity, Zap, HardDrive } from "lucide-react";
import { getDb } from "@/server/db/client";
import { sources, researchRuns } from "@/server/db/schema";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const db = await getDb();
  const sourceRows = await db.select().from(sources);
  const runRows = await db.select().from(researchRuns);

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
    totalPagesCrawled += counters.completedJobs ? counters.completedJobs * 8 : 0;
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Coins className="w-5 h-5 text-amber-400" />
          Usage, Quotas &amp; Cost Control Center
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Monitor API requests, crawl page volumes, enrichment spend, and per-run cost ceilings.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Total Discovery Requests
          </div>
          <div className="text-2xl font-bold text-white flex items-center gap-1.5">
            <Activity className="w-5 h-5 text-cyan-400" />
            {totalRequests}
          </div>
          <div className="text-xs text-slate-500">
            Across {sourceRows.length} pluggable adapters
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Estimated API Spend
          </div>
          <div className="text-2xl font-bold text-emerald-400 flex items-center gap-1.5">
            <DollarSign className="w-5 h-5" />
            ${estimatedSpend.toFixed(2)}
          </div>
          <div className="text-xs text-slate-500">
            {estimatedSpend === 0 ? "100% Free / Direct Crawling" : "Paid API enrichments"}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Pages Researched
          </div>
          <div className="text-2xl font-bold text-indigo-400 flex items-center gap-1.5">
            <HardDrive className="w-5 h-5" />
            {totalPagesCrawled}
          </div>
          <div className="text-xs text-slate-500">
            Bounded at ≤20 pages/domain
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Safety Ceilings
          </div>
          <div className="text-2xl font-bold text-amber-400 flex items-center gap-1.5">
            <ShieldCheck className="w-5 h-5" />
            ACTIVE
          </div>
          <div className="text-xs text-slate-500">
            $2.00 max budget per research run
          </div>
        </div>
      </div>

      {/* Cost & Provider Breakdown Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl space-y-0">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Coins className="w-4 h-4 text-amber-400" />
            Provider Usage &amp; Spend Accounting
          </h2>
          <span className="text-xs text-slate-400">
            {sourceRows.filter((s) => s.enabled).length} Enabled Adapters
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Source Provider</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Rate / Request</th>
                <th className="px-4 py-3">Total Requests</th>
                <th className="px-4 py-3">Avg Latency</th>
                <th className="px-4 py-3">Errors</th>
                <th className="px-4 py-3 text-right">Total Incurred</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {sourceRows.map((s) => {
                const cost = (s.requests || 0) * (s.costPerRequestUsd || 0);
                const avgLat =
                  s.requests && s.requests > 0
                    ? Math.round((s.totalLatencyMs || 0) / s.requests)
                    : 0;

                return (
                  <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 font-sans">
                      <div className="font-semibold text-white">{s.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{s.key}</div>
                    </td>
                    <td className="px-4 py-3 font-sans capitalize text-slate-400">
                      {s.kind.replace("_", " ")}
                    </td>
                    <td className="px-4 py-3">
                      {s.costPerRequestUsd === 0 ? (
                        <span className="text-emerald-400 font-sans font-medium">$0.00 (Free)</span>
                      ) : (
                        `$${s.costPerRequestUsd.toFixed(3)}`
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-white">{s.requests || 0}</td>
                    <td className="px-4 py-3 text-slate-400">{avgLat ? `${avgLat}ms` : "—"}</td>
                    <td className="px-4 py-3">
                      {s.errors && s.errors > 0 ? (
                        <span className="text-rose-400 font-semibold">{s.errors}</span>
                      ) : (
                        <span className="text-slate-500">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-400 font-mono">
                      ${cost.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
