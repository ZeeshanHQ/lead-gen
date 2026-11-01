import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { researchRuns } from "@/server/db/schema";
import { getRunTelemetry } from "@/server/research/telemetry";
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
    const [runRow] = await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.id, runId))
      .limit(1);

    if (!runRow) {
      return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404 });
    }

    const logs = getRunTelemetry(runId, sinceIso);
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
