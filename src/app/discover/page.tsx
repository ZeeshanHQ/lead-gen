import React from "react";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { LeadProspector } from "./lead-prospector";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function DiscoverPage() {
  const db = await getDb();
  const ctx = await getActiveContext(db);

  return (
    <div className="space-y-6">
      <LeadProspector key={ctx.market.id} activeMarket={ctx.market} />
    </div>
  );
}
