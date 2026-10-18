"use client";

import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import {
  Zap,
  Sparkles,
  Layers,
  Database,
  Search,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Building,
  MapPin,
  Flame,
  ArrowRight,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import {
  runBulkDiscoveryAction,
  runTavilyTestDiscoveryAction,
  getActiveRulesForDiscoveryAction,
} from "./actions";

interface BulkCounters {
  totalCandidates: number;
  createdCompanies: number;
  duplicatesMerged: number;
  excludedCount: number;
  completedJobs: number;
  failedJobs: number;
  factsRecorded: number;
  contactsDiscovered: number;
}

export function BulkDiscover() {
  const [isPending, startTransition] = useTransition();
  const [runningTavily, setRunningTavily] = useState(false);
  const [targetCount, setTargetCount] = useState<number>(100);
  const [concurrency, setConcurrency] = useState<number>(4);
  const [activeRule, setActiveRule] = useState<any>(null);
  const [runResult, setRunResult] = useState<{
    runId: string;
    counters: BulkCounters;
    targetCount: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    getActiveRulesForDiscoveryAction().then((res) => {
      if (res.ok) setActiveRule(res.rule);
    });
  }, []);

  const handleStartBulk = () => {
    setErrorMsg(null);
    setRunResult(null);
    setRunningTavily(false);

    startTransition(async () => {
      const res = await runBulkDiscoveryAction({
        targetCount,
        concurrency,
      });

      if (res.ok && res.runId && res.counters) {
        setRunResult({
          runId: res.runId,
          counters: res.counters,
          targetCount: res.targetCount || targetCount,
        });
      } else {
        setErrorMsg(res.error || "Bulk discovery failed. Please try again.");
      }
    });
  };

  const handleStartTavily = () => {
    setErrorMsg(null);
    setRunResult(null);
    setRunningTavily(true);

    startTransition(async () => {
      const res = await runTavilyTestDiscoveryAction();
      setRunningTavily(false);

      if (res.ok && res.runId && res.counters) {
        setRunResult({
          runId: res.runId,
          counters: res.counters,
          targetCount: 20,
        });
      } else {
        setErrorMsg(res.error || "Tavily test discovery failed. Please check API key in Sources tab.");
      }
    });
  };

  const states = activeRule?.geography?.states || ["TX", "FL", "GA", "NC", "OH", "AZ"];
  const minScore = activeRule?.scoring?.minimumIcpScore ?? 60;
  const services = activeRule?.services?.requiredServices || [
    "HVAC replacement",
    "AC replacement",
    "Heating installation",
  ];

  return (
    <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-b from-slate-900/95 to-slate-950 p-6 shadow-xl shadow-cyan-950/20 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Zap className="w-3 h-3 text-cyan-400 animate-pulse" />
              Live Bulk Lead Engine
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              100% Free APIs &amp; Zero Hallucinations
            </span>
          </div>
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            One-Click Real-Time HVAC Lead Discovery
          </h2>
          <p className="text-xs text-slate-400 max-w-2xl">
            Automatically queries official state contractor rolls, municipal licensing open data, and trade directories matching your active operating rules. Deduplicates against your pipeline and scores every lead with source citations.
          </p>
        </div>

        <Link
          href="/rules"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 text-xs font-medium text-slate-300 hover:text-white transition-colors self-start md:self-auto"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
          Edit Active Filter Rules
        </Link>
      </div>

      {/* Active Rules Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs">
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            Target Geography
          </div>
          <div className="text-slate-200 font-mono text-[11px]">
            {states.join(", ")} (US Residential)
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            Required Services
          </div>
          <div className="text-slate-200 truncate">
            {services.slice(0, 3).join(", ")}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Qualification Gate
          </div>
          <div className="text-slate-200">
            Min ICP Score: <span className="font-bold text-emerald-400">{minScore}/100</span> · Needs Human Approval
          </div>
        </div>
      </div>

      {/* Controls & Triggers */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-1">
        {/* Batch Target Selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300 block">
            Target Batch Size:
          </label>
          <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800">
            {[25, 50, 100, 150].map((size) => (
              <button
                key={size}
                type="button"
                disabled={isPending}
                onClick={() => setTargetCount(size)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  targetCount === size
                    ? "bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-950"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {size === 100 ? `⚡ ${size}+ Leads` : `${size} Leads`}
              </button>
            ))}
          </div>
        </div>

        {/* Parallel Concurrency Selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300 block">
            Processing Concurrency:
          </label>
          <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConcurrency(4)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                concurrency === 4
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              4 Workers (Standard)
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConcurrency(6)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                concurrency === 6
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              6 Workers (Turbo)
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-2.5 sm:self-end">
          <button
            type="button"
            disabled={isPending}
            onClick={handleStartTavily}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-xs shadow-md border transition-all ${
              isPending && runningTavily
                ? "bg-slate-800 text-slate-400 border-slate-700 cursor-not-allowed"
                : "bg-slate-900 hover:bg-slate-800 text-cyan-300 border-cyan-500/40 hover:border-cyan-400 active:scale-[0.98]"
            }`}
          >
            {isPending && runningTavily ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                <span>Searching Tavily Web API...</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5 text-cyan-400" />
                <span>🌐 Test Tavily Search (3 Queries, 20 Leads)</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={isPending}
            onClick={handleStartBulk}
            className={`w-full sm:w-auto flex items-center justify-center gap-2.5 px-6 py-2.5 rounded-lg font-bold text-xs shadow-lg transition-all ${
              isPending && !runningTavily
                ? "bg-cyan-600/50 text-slate-300 cursor-not-allowed border border-cyan-500/30"
                : "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-950/50 hover:shadow-cyan-900/60 active:scale-[0.98]"
            }`}
          >
            {isPending && !runningTavily ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-cyan-200" />
                <span>Running Bulk Discovery...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-slate-950 text-slate-950" />
                <span>One-Click Discover {targetCount}+ Leads</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Progress & Live Status Banner */}
      {isPending && (
        <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/40 space-y-3 animate-pulse">
          <div className="flex items-center gap-2.5 text-cyan-300 text-xs font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Executing Live Multi-Source HVAC Lead Generation Pipeline...</span>
          </div>
          <div className="text-[11px] text-slate-400 space-y-1">
            <p>1. Querying trade directories, state licensing rolls (TDLR/CSLB), and live municipal open registries...</p>
            <p>2. Normalizing phone numbers, websites, domains, and checking deduplication against current accounts...</p>
            <p>3. Crawling public company sites to verify residential replacement services, financing, and decision makers...</p>
            <p>4. Calculating ICP fit scores and sending qualified accounts into the Review Queue.</p>
          </div>
        </div>
      )}

      {/* Error Display */}
      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-red-950/40 border border-red-800/80 text-xs text-red-200 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Run Complete Summary Card */}
      {runResult && (
        <div className="p-5 rounded-xl bg-emerald-950/20 border border-emerald-500/40 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-emerald-400 text-sm font-bold">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>Bulk Discovery Run Completed Successfully!</span>
            </div>
            <Link
              href="/review"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md shadow-emerald-950/50 transition-colors"
            >
              <span>Open Review Queue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="text-slate-400 text-[11px]">Total Candidates Found</div>
              <div className="text-base font-bold text-white mt-0.5">
                {runResult.counters.totalCandidates}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="text-slate-400 text-[11px]">New Companies Created</div>
              <div className="text-base font-bold text-cyan-400 mt-0.5">
                {runResult.counters.createdCompanies}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="text-slate-400 text-[11px]">Duplicates Merged</div>
              <div className="text-base font-bold text-slate-300 mt-0.5">
                {runResult.counters.duplicatesMerged}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800">
              <div className="text-slate-400 text-[11px]">Verified Facts Grounded</div>
              <div className="text-base font-bold text-emerald-400 mt-0.5">
                {runResult.counters.factsRecorded}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
