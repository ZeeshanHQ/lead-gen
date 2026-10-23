import React from "react";
import { getDb } from "@/server/db/client";
import { loadLeadRows, distinctStates } from "@/server/repo/queue";
import { getActiveContext } from "@/server/repo/markets";
import { ReviewTable } from "./review-table";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  let leads: any[] = [];
  let states: string[] = [];
  let marketName = "Active Niche";
  let marketId = "";

  try {
    const db = await getDb();
    const ctx = await getActiveContext(db);
    marketName = ctx.market.name;
    marketId = ctx.market.id;
    leads = await loadLeadRows(db, "review", ctx.market.id);
    states = await distinctStates(db, ctx.market.id);
  } catch (err: any) {
    console.error("Error loading Review Queue:", err);
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white">
            Review Queue — {marketName}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Review researched companies for <strong className="text-slate-200">{marketName}</strong> and approve the best ones for your CRM.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="px-3 py-1 rounded-lg bg-slate-900 text-slate-300 border border-slate-800 font-medium">
            {leads.length} Pending Review
          </span>
        </div>
      </div>

      <ReviewTable key={marketId} initialRows={leads} states={states} />
    </div>
  );
}
