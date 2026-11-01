/**
 * Real-Time Telemetry & Event Stream for Discovery Runs
 *
 * Captures live events (Tavily queries, domain crawls, contact extractions,
 * anti-dump rejections, and approved ICP leads) for display in the interactive
 * discovery terminal.
 */

export type TelemetryLogLevel = "info" | "success" | "warn" | "error" | "rejection";
export type TelemetryStage =
  | "INIT"
  | "SEARCH"
  | "CRAWL"
  | "EXTRACT"
  | "GATE"
  | "APPROVED"
  | "REPLENISH"
  | "COMPLETED"
  | "FAILED";

export interface TelemetryLogEntry {
  id: string;
  runId: string;
  seq?: number;
  timestamp: string; // HH:mm:ss format
  isoTime: string;
  level: TelemetryLogLevel;
  stage: TelemetryStage;
  message: string;
  companyName?: string;
  domain?: string;
  phone?: string;
  details?: Record<string, unknown>;
}

// Global in-memory ring-buffer per runId (keeps latest 500 logs per active run)
const MAX_LOGS_PER_RUN = 500;
const runLogsStore = new Map<string, TelemetryLogEntry[]>();
const runLastActivityStore = new Map<string, number>();
const runSeqStore = new Map<string, number>();

function formatTime(d: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function recordRunTelemetry(
  runId: string,
  entry: {
    level: TelemetryLogLevel;
    stage: TelemetryStage;
    message: string;
    companyName?: string;
    domain?: string;
    phone?: string;
    details?: Record<string, unknown>;
  }
): TelemetryLogEntry {
  if (!runId) {
    return {
      id: "orphan",
      runId: "",
      seq: 0,
      timestamp: formatTime(),
      isoTime: new Date().toISOString(),
      ...entry,
    };
  }

  const now = new Date();
  const nextSeq = (runSeqStore.get(runId) || 0) + 1;
  runSeqStore.set(runId, nextSeq);

  const logEntry: TelemetryLogEntry = {
    id: `${runId}_${nextSeq}`,
    runId,
    seq: nextSeq,
    timestamp: formatTime(now),
    isoTime: now.toISOString(),
    ...entry,
  };

  const existing = runLogsStore.get(runId) || [];
  existing.push(logEntry);
  if (existing.length > MAX_LOGS_PER_RUN) {
    existing.shift();
  }
  runLogsStore.set(runId, existing);
  runLastActivityStore.set(runId, Date.now());

  // Clean up stale runs older than 2 hours to avoid memory leaks
  if (runLogsStore.size > 50) {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, lastTime] of runLastActivityStore.entries()) {
      if (lastTime < twoHoursAgo) {
        runLogsStore.delete(id);
        runLastActivityStore.delete(id);
        runSeqStore.delete(id);
      }
    }
  }

  return logEntry;
}

export function getRunTelemetry(
  runId: string,
  sinceParam?: string | number
): TelemetryLogEntry[] {
  if (!runId) return [];
  const logs = runLogsStore.get(runId) || [];
  if (sinceParam === undefined || sinceParam === null || sinceParam === "") {
    return [...logs];
  }

  // If sinceParam is a sequence number or numeric string
  const numSeq = typeof sinceParam === "number" ? sinceParam : parseInt(sinceParam, 10);
  if (Number.isFinite(numSeq) && numSeq >= 0 && typeof sinceParam === "number") {
    return logs.filter((l) => (l.seq ?? 0) > numSeq);
  }

  // If sinceParam is an ISO date string or log ID
  if (typeof sinceParam === "string") {
    if (sinceParam.includes("_")) {
      const parts = sinceParam.split("_");
      const idSeq = parseInt(parts[parts.length - 1] || "", 10);
      if (Number.isFinite(idSeq)) {
        return logs.filter((l) => (l.seq ?? 0) > idSeq);
      }
    }
    return logs.filter((l) => l.isoTime > sinceParam);
  }

  return [...logs];
}

export function clearRunTelemetry(runId: string): void {
  if (runId) {
    runLogsStore.delete(runId);
    runLastActivityStore.delete(runId);
    runSeqStore.delete(runId);
  }
}
