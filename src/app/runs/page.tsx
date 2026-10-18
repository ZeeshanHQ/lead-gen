import React from "react";
import { PlaySquare } from "lucide-react";
import { getDb } from "@/server/db/client";
import { getRecentRuns } from "@/server/research/runner";
import { getActiveContext } from "@/server/repo/markets";
import { RunsClient } from "./runs-client";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const db = await getDb();
  const { market } = await getActiveContext(db);
  const rawRuns = await getRecentRuns(db, 30, market.id);

  const runs = rawRuns.map((r) => ({
    id: r.id,
    mode: r.mode,
    status: r.status,
    dryRun: r.dryRun,
    counters: (r.counters as Record<string, number>) || {},
    limits: (r.limits as Record<string, any>) || {},
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    lastError: r.lastError,
    actor: r.actor,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <PlaySquare className="w-5 h-5 text-cyan-400" />
          Research Runs &amp; Jobs — {market.name}
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Automated lead discovery engine, multi-candidate crawler execution, and review queue feeder for <strong>{market.name}</strong>.
        </p>
      </div>

      <RunsClient key={market.id} runs={runs} />
    </div>
  );
}
