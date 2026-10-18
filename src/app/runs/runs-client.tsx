"use client";

import React, { useState, useTransition } from "react";
import {
  PlaySquare,
  Pause,
  XCircle,
  RotateCcw,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  UserCheck,
  TrendingUp,
} from "lucide-react";
import { triggerRunAction, pauseRunAction, cancelRunAction } from "./actions";

interface RunRow {
  id: string;
  mode: string;
  status: string;
  dryRun: boolean;
  counters: Record<string, number>;
  limits: Record<string, any>;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  actor: string | null;
  createdAt: string;
}

export function RunsClient({ runs }: { runs: RunRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [showModal, setShowModal] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunRow | null>(null);

  // Form states
  const [mode, setMode] = useState<string>("small");
  const [maxCandidates, setMaxCandidates] = useState<number>(15);
  const [concurrency, setConcurrency] = useState<number>(2);
  const [pagesPerCompany, setPagesPerCompany] = useState<number>(12);
  const [dryRun, setDryRun] = useState<boolean>(false);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append("mode", mode);
    fd.append("maxCandidates", String(maxCandidates));
    fd.append("concurrency", String(concurrency));
    fd.append("pagesPerCompany", String(pagesPerCompany));
    fd.append("dryRun", String(dryRun));

    startTransition(async () => {
      await triggerRunAction(fd);
      setShowModal(false);
    });
  };

  const handlePause = (runId: string) => {
    startTransition(async () => {
      await pauseRunAction(runId);
    });
  };

  const handleCancel = (runId: string) => {
    startTransition(async () => {
      await cancelRunAction(runId);
    });
  };

  return (
    <div className="space-y-6">
      {/* Top action header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Execution Runs</h2>
          <p className="text-xs text-slate-400">
            {runs.length} runs executed. Bounded concurrency, politely paced crawler.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setMode("full");
              setMaxCandidates(100);
              setConcurrency(4);
              setShowModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md shadow-cyan-950/40 transition-colors"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            ⚡ Bulk Run (100+ Leads)
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Configure Custom Run
          </button>
        </div>
      </div>

      {/* Modal for starting new run */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <PlaySquare className="w-4 h-4 text-cyan-400" />
                Configure Research Run
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleStart} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Run Mode
                </label>
                <select
                  value={mode}
                  onChange={(e) => {
                    const m = e.target.value;
                    setMode(m);
                    if (m === "test") setMaxCandidates(3);
                    else if (m === "small") setMaxCandidates(15);
                    else if (m === "full") {
                      setMaxCandidates(100);
                      setConcurrency(4);
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="full">⚡ Bulk Run (100+ Leads - Recommended Bulk Prospecting)</option>
                  <option value="small">Small Run (15 Leads - Default Batch)</option>
                  <option value="test">Test Run (3 Leads - Fast Verification)</option>
                  <option value="stale">Re-research Stale Leads (Past 30 Days)</option>
                  <option value="rejected">Re-evaluate Rejected Leads</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">
                    Max Candidates
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={maxCandidates}
                    onChange={(e) => setMaxCandidates(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">
                    Concurrency
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Max Pages per Company
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={pagesPerCompany}
                  onChange={(e) => setPagesPerCompany(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  Bounded at 20 pages max. Prioritizes replacement, financing, about, team.
                </span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="dryRunCheck"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
                />
                <label htmlFor="dryRunCheck" className="text-xs text-slate-300">
                  Dry Run Mode (Simulate without persistent scoring)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 rounded-md text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold text-xs shadow"
                >
                  {isPending ? "Starting..." : "Start Run Now"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Runs List Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Run ID / Mode</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Candidates</th>
                <th className="px-4 py-3">Jobs Done</th>
                <th className="px-4 py-3">Evidence Found</th>
                <th className="px-4 py-3">Started At</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500 font-sans">
                    No research runs yet. Click &quot;Start Research Run&quot; above to initiate lead discovery and evaluation.
                  </td>
                </tr>
              ) : (
                runs.map((r) => {
                  const counters = r.counters || {};
                  return (
                    <tr key={r.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 font-sans">
                        <div className="font-semibold text-white flex items-center gap-2">
                          <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono">
                            {r.mode}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {r.id.slice(0, 8)}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          by {r.actor || "local-user"} {r.dryRun && "• Dry Run"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-sans font-medium ${
                            r.status === "COMPLETED"
                              ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800/60"
                              : r.status === "RUNNING"
                              ? "bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 animate-pulse"
                              : r.status === "PARTIAL"
                              ? "bg-amber-950/80 text-amber-400 border border-amber-800/60"
                              : r.status === "FAILED"
                              ? "bg-rose-950/80 text-rose-400 border border-rose-800/60"
                              : "bg-slate-800 text-slate-300"
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-sans">
                        <span className="text-white font-semibold">
                          {counters.totalCandidates || 0}
                        </span>{" "}
                        <span className="text-slate-500 text-[11px]">
                          ({counters.createdCompanies || 0} new, {counters.duplicatesMerged || 0} merged)
                        </span>
                      </td>
                      <td className="px-4 py-3 font-sans">
                        <span className="text-emerald-400 font-semibold">
                          {counters.completedJobs || 0}
                        </span>
                        {(counters.failedJobs ?? 0) > 0 && (
                          <span className="text-rose-400 ml-1">
                            ({counters.failedJobs} failed)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-sans">
                        <div className="flex items-center gap-2 text-slate-300">
                          <span className="flex items-center gap-1 text-[11px]">
                            <FileText className="w-3 h-3 text-cyan-400" />
                            {counters.factsRecorded || 0}
                          </span>
                          <span className="flex items-center gap-1 text-[11px]">
                            <UserCheck className="w-3 h-3 text-indigo-400" />
                            {counters.contactsDiscovered || 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-400 font-sans">
                        {r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : "Pending"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.status === "RUNNING" && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handlePause(r.id)}
                              disabled={isPending}
                              title="Pause run"
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-400"
                            >
                              <Pause className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleCancel(r.id)}
                              disabled={isPending}
                              title="Cancel run"
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-rose-400"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {r.status !== "RUNNING" && (
                          <span className="text-[11px] text-slate-500 font-sans">Archived</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
