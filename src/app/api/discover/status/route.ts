import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { researchJobs, researchRuns } from "@/server/db/schema";
import { getRunTelemetry, type TelemetryLogEntry } from "@/server/research/telemetry";
import { executeQueuedBatch } from "@/server/research/runner";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { loadLeadRows } from "@/server/repo/queue";
import { resolveGate, passesLeadRowGate } from "@/server/domain/gate";
import { POST_APPROVAL } from "@/server/domain/lifecycle";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId");
    const sinceIso = searchParams.get("since") || undefined;

    if (!runId) {
      return NextResponse.json({ ok: false, error: "Missing runId parameter" }, { status: 400 });
    }

    const db = await getDb();
    let [runRow] = await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.id, runId))
      .limit(1);

    if (!runRow) {
      return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404 });
    }

    // Serverless Driver: If run is RUNNING, execute the next chunk of queued jobs in this active HTTP cycle
    if (runRow.status === "RUNNING") {
      try {
        await executeQueuedBatch(db, runId, 5);
        const [refreshed] = await db
          .select()
          .from(researchRuns)
          .where(eq(researchRuns.id, runId))
          .limit(1);
        if (refreshed) {
          runRow = refreshed;
        }
      } catch (execErr) {
        console.error("Batch execution error in /api/discover/status:", execErr);
      }
    }

    // Persisted & In-Memory Telemetry Synthesis: Guarantee 0 dropped logs across serverless lambdas
    const memoryLogs = getRunTelemetry(runId, sinceIso);
    const completedJobs = await db
      .select({
        id: researchJobs.id,
        status: researchJobs.status,
        result: researchJobs.result,
        finishedAt: researchJobs.finishedAt,
      })
      .from(researchJobs)
      .where(
        and(
          eq(researchJobs.runId, runId),
          inArray(researchJobs.status, ["COMPLETED", "FAILED"])
        )
      )
      .orderBy(desc(researchJobs.finishedAt))
      .limit(60);

    const dbLogs: TelemetryLogEntry[] = [];
    const sinceTime = sinceIso ? new Date(sinceIso).getTime() : 0;

    for (const j of completedJobs) {
      if (!j.finishedAt) continue;
      const jobTime = j.finishedAt.getTime();
      if (sinceTime > 0 && jobTime <= sinceTime) continue;

      const res = j.result as any;
      if (j.status === "COMPLETED" && res) {
        const isApproved =
          (res.status === "APPROVED" || res.status === "NEEDS_REVIEW") &&
          res.icpScore >= 60;
        const timeStr = j.finishedAt.toTimeString().slice(0, 8);
        if (isApproved) {
          dbLogs.push({
            id: `job-app-${j.id}`,
            runId,
            timestamp: timeStr,
            isoTime: j.finishedAt.toISOString(),
            stage: "APPROVED",
            level: "success",
            companyName: res.companyName,
            domain: res.domain,
            message: `[ACCEPTED: ICP Qualified] "${res.companyName}" (${res.domain}) • Score: ${res.icpScore}/100 • Discovered ${res.contactsDiscovered} contacts & ${res.factsRecorded} verified facts.`,
          });
        } else {
          const reason =
            res.gateReasons?.length
              ? res.gateReasons.join("; ")
              : res.gateMissing?.length
              ? `Missing: ${res.gateMissing.join(", ")}`
              : res.summary || "Did not meet strict ICP thresholds";
          dbLogs.push({
            id: `job-gate-${j.id}`,
            runId,
            timestamp: timeStr,
            isoTime: j.finishedAt.toISOString(),
            stage: "GATE",
            level: "rejection",
            companyName: res.companyName,
            domain: res.domain,
            message: `[REJECTED: Quality Gate] "${res.companyName}" (${res.domain}) — ${reason}`,
          });
        }
      }
    }

    const logMap = new Map<string, TelemetryLogEntry>();
    for (const l of memoryLogs) logMap.set(l.id, l);
    for (const l of dbLogs) {
      if (!logMap.has(l.id)) logMap.set(l.id, l);
    }
    const logs = Array.from(logMap.values()).sort((a, b) => a.isoTime.localeCompare(b.isoTime));

    const isFinished =
      runRow.status === "COMPLETED" ||
      runRow.status === "FAILED" ||
      runRow.status === "CANCELLED" ||
      runRow.status === "PARTIAL";

    let leads: any[] = [];
    let totalReviewCount = 0;
    let crmReadyCount = 0;

    if (isFinished && runRow.marketId) {
      const [{ activeMember }, { rule }] = await Promise.all([
        getActiveTeamMember(db),
        getActiveContext(db),
      ]);

      const isOwnerOrManager =
        activeMember.role === "OWNER" || Boolean(activeMember.permissions?.manageTeamAndSettings);
      const allMarketRows = await loadLeadRows(db, "all", runRow.marketId);
      const scopedRows = isOwnerOrManager
        ? allMarketRows
        : allMarketRows.filter((l) => l.assignedMemberId === activeMember.id);

      const activeRuleConfig = (rule.config as any) || null;
      const activeGate = resolveGate(activeRuleConfig?.gate);
      const postApprovalSet = new Set<string>(POST_APPROVAL as readonly string[]);

      const qualifiedLeads = scopedRows.filter((l) => passesLeadRowGate(l, activeGate, activeRuleConfig));
      const pendingLeads = qualifiedLeads.filter((l) => !postApprovalSet.has(l.status));
      crmReadyCount = qualifiedLeads.filter((l) => postApprovalSet.has(l.status)).length;
      totalReviewCount = pendingLeads.length;
      leads = JSON.parse(JSON.stringify(pendingLeads.slice(0, 60)));
    }

    return NextResponse.json(
      {
        ok: true,
        runId,
        status: runRow.status,
        counters: runRow.counters || {},
        logs,
        isFinished,
        lastError: runRow.lastError,
        leads,
        totalReviewCount,
        crmReadyCount,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to fetch run status" },
      { status: 500 }
    );
  }
}
