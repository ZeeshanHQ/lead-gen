"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Terminal,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Globe,
  ShieldAlert,
  Search,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  X,
  Clock,
  Sparkles,
} from "lucide-react";
import type { TelemetryLogEntry } from "@/server/research/telemetry";

export interface TerminalCounters {
  scanned: number;
  inspected: number;
  rejected: number;
  approved: number;
  target: number;
}

export function DiscoveryTerminal({
  runId,
  isRunning,
  logs = [],
  counters,
  elapsedSeconds = 0,
  onClose,
  onClear,
}: {
  runId: string | null;
  isRunning: boolean;
  logs: TelemetryLogEntry[];
  counters: TerminalCounters;
  elapsedSeconds?: number;
  onClose?: () => void;
  onClear?: () => void;
}) {
  const [filterType, setFilterType] = useState<"all" | "approved" | "rejected" | "crawl">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const terminalScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom as logs stream in
  useEffect(() => {
    if (autoScroll && terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [logs.length, autoScroll, isCollapsed]);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filterType === "approved") {
        if (log.stage !== "APPROVED" && log.level !== "success") return false;
      } else if (filterType === "rejected") {
        if (log.stage !== "GATE" && log.level !== "rejection" && log.level !== "warn") return false;
      } else if (filterType === "crawl") {
        if (log.stage !== "CRAWL" && log.stage !== "SEARCH") return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          log.message.toLowerCase().includes(query) ||
          (log.companyName && log.companyName.toLowerCase().includes(query)) ||
          (log.domain && log.domain.toLowerCase().includes(query)) ||
          log.stage.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [logs, filterType, searchQuery]);

  const approvedCount = useMemo(
    () => logs.filter((l) => l.stage === "APPROVED" || l.level === "success").length,
    [logs]
  );
  const rejectedCount = useMemo(
    () => logs.filter((l) => l.stage === "GATE" || l.level === "rejection").length,
    [logs]
  );
  const crawlCount = useMemo(
    () => logs.filter((l) => l.stage === "CRAWL" || l.stage === "SEARCH").length,
    [logs]
  );

  const handleCopyLogs = () => {
    const plainText = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.stage}] ${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(plainText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl bg-[#070709] border border-zinc-800 shadow-2xl overflow-hidden transition-all duration-200">
      {/* Top Window Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-[#0d0d11] border-b border-zinc-800/80">
        <div className="flex items-center gap-3">
          {/* OS-style dots */}
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
          </div>

          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-zinc-400" />
            <span className="font-mono text-xs font-bold text-zinc-200 tracking-wider">
              DISCOVERY &amp; CRAWL CONSOLE
            </span>
            {runId && (
              <span className="hidden md:inline font-mono text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                RUN: {runId.slice(0, 8)}
              </span>
            )}
          </div>

          {/* Running / Complete status indicator */}
          <div className="flex items-center gap-1.5 pl-2">
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                LIVE CRAWL ACTIVE
              </span>
            ) : logs.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-blue-500/15 text-blue-400 border border-blue-500/30">
                <CheckCircle2 className="w-3 h-3 text-blue-400" />
                EXECUTION FINISHED
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-zinc-800 text-zinc-400">
                IDLE
              </span>
            )}
          </div>
        </div>

        {/* Action Controls & Elapsed Timer */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-xs text-zinc-300">
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            <span>{formatTimer(elapsedSeconds)}</span>
          </div>

          <button
            type="button"
            onClick={handleCopyLogs}
            disabled={filteredLogs.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white font-mono text-xs transition"
            title="Copy Console Output"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setAutoScroll((prev) => !prev)}
            className={`px-2 py-1 rounded-lg border font-mono text-[11px] transition ${
              autoScroll
                ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-400"
            }`}
            title="Toggle Auto-Scroll"
          >
            Auto-Scroll: {autoScroll ? "ON" : "OFF"}
          </button>

          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="px-2 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white font-mono text-[11px] transition"
              title="Clear Console Output"
            >
              Clear
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="p-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition"
            title={isCollapsed ? "Expand Terminal" : "Collapse Terminal"}
          >
            {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-rose-400 transition"
              title="Close Terminal"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Real-Time Metric Counters Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-4 py-2.5 bg-[#09090c] border-b border-zinc-850">
            <div className="flex items-center justify-between p-2 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
              <span className="text-[11px] text-zinc-400 font-mono flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                Scanned
              </span>
              <span className="font-mono text-xs font-bold text-zinc-200">
                {counters.scanned || 0}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
              <span className="text-[11px] text-zinc-400 font-mono flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                Inspected
              </span>
              <span className="font-mono text-xs font-bold text-amber-300">
                {counters.inspected || 0}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-xl bg-zinc-950/80 border border-rose-900/30">
              <span className="text-[11px] text-rose-300/80 font-mono flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                Anti-Dump Blocked
              </span>
              <span className="font-mono text-xs font-bold text-rose-400">
                {counters.rejected || 0}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-950/20 border border-emerald-800/40">
              <span className="text-[11px] text-emerald-300 font-mono flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ICP Qualified
              </span>
              <span className="font-mono text-xs font-bold text-emerald-300">
                {counters.approved || 0}
              </span>
            </div>

            <div className="col-span-2 sm:col-span-1 flex items-center justify-between p-2 rounded-xl bg-zinc-950/80 border border-zinc-800/80">
              <span className="text-[11px] text-zinc-400 font-mono flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                Target Goal
              </span>
              <span className="font-mono text-xs font-bold text-white">
                {counters.target || 25}
              </span>
            </div>
          </div>

          {/* Filter Bar & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2 bg-[#09090c] border-b border-zinc-850">
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
              <button
                type="button"
                onClick={() => setFilterType("all")}
                className={`px-2.5 py-1 rounded-lg transition ${
                  filterType === "all"
                    ? "bg-zinc-800 text-white font-bold"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                All Telemetry ({logs.length})
              </button>

              <button
                type="button"
                onClick={() => setFilterType("approved")}
                className={`px-2.5 py-1 rounded-lg transition ${
                  filterType === "approved"
                    ? "bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40"
                    : "text-emerald-400/80 hover:text-emerald-300"
                }`}
              >
                ✅ Approved Leads ({approvedCount})
              </button>

              <button
                type="button"
                onClick={() => setFilterType("rejected")}
                className={`px-2.5 py-1 rounded-lg transition ${
                  filterType === "rejected"
                    ? "bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40"
                    : "text-rose-400/80 hover:text-rose-300"
                }`}
              >
                🛡️ Anti-Dump Rejections ({rejectedCount})
              </button>

              <button
                type="button"
                onClick={() => setFilterType("crawl")}
                className={`px-2.5 py-1 rounded-lg transition ${
                  filterType === "crawl"
                    ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40"
                    : "text-cyan-400/80 hover:text-cyan-300"
                }`}
              >
                🌐 Web &amp; Search ({crawlCount})
              </button>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter logs by name, domain, city..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full sm:w-60 bg-zinc-900/90 border border-zinc-800 rounded-lg pl-8 pr-2.5 py-1 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
              />
            </div>
          </div>

          {/* Terminal Console Viewport */}
          <div
            ref={terminalScrollRef}
            className="h-72 overflow-y-auto p-4 space-y-1.5 font-mono text-[11px] leading-relaxed bg-[#050507] selection:bg-emerald-900/60 selection:text-white"
          >
            {filteredLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-2">
                <Terminal className="w-8 h-8 text-zinc-600" />
                <p className="text-xs">
                  {logs.length === 0
                    ? "Ready to crawl. Click 'Find & Qualify Leads' above to begin real-time discovery."
                    : "No log events match your current filter."}
                </p>
                {logs.length === 0 && (
                  <p className="text-[10px] text-zinc-600 max-w-sm">
                    Live telemetry will stream search queries, anti-dump filters, domain crawling,
                    and quality gate evaluations in real time.
                  </p>
                )}
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isApproved = log.stage === "APPROVED" || log.level === "success";
                const isRejected = log.stage === "GATE" || log.level === "rejection";
                const isCrawl = log.stage === "CRAWL" || log.stage === "SEARCH";
                const isCompleted = log.stage === "COMPLETED";

                return (
                  <div
                    key={log.id}
                    className={`flex items-start gap-2 py-0.5 px-2 rounded-md transition-colors ${
                      isApproved
                        ? "bg-emerald-950/25 border border-emerald-900/40 text-emerald-300"
                        : isRejected
                        ? "bg-rose-950/20 border border-rose-900/30 text-rose-300/90"
                        : isCompleted
                        ? "bg-blue-950/30 border border-blue-900/40 text-blue-200 font-bold"
                        : "hover:bg-zinc-900/50 text-zinc-300"
                    }`}
                  >
                    {/* Timestamp */}
                    <span className="text-zinc-500 shrink-0 font-mono text-[10px] select-none pt-0.5">
                      [{log.timestamp}]
                    </span>

                    {/* Stage Badge */}
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.2 rounded shrink-0 select-none ${
                        isApproved
                          ? "bg-emerald-900/60 text-emerald-200 border border-emerald-700/60"
                          : isRejected
                          ? "bg-rose-900/60 text-rose-200 border border-rose-700/60"
                          : isCrawl
                          ? "bg-cyan-900/40 text-cyan-300 border border-cyan-800/50"
                          : isCompleted
                          ? "bg-indigo-900/60 text-indigo-200 border border-indigo-700/60"
                          : "bg-zinc-850 text-zinc-400 border border-zinc-750"
                      }`}
                    >
                      {log.stage}
                    </span>

                    {/* Log Message */}
                    <span className="flex-1 break-all whitespace-pre-wrap">{log.message}</span>
                  </div>
                );
              })
            )}

            {/* Blinking cursor at the end while running */}
            {isRunning && (
              <div className="flex items-center gap-1 text-emerald-400 font-bold pl-2 pt-1 animate-pulse">
                <span>&gt;</span>
                <span className="w-2 h-3.5 bg-emerald-400 inline-block" />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
