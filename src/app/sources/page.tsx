import React from "react";
import { Radio } from "lucide-react";
import { getDb } from "@/server/db/client";
import { listProviders } from "@/server/providers/registry";
import { sources as sourcesTable } from "@/server/db/schema";
import { SourcesClient } from "./sources-client";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const db = await getDb();
  const providers = await listProviders(db);
  const rows = await db.select().from(sourcesTable);
  const rowMap = new Map(rows.map((r) => [r.key, r]));

  const sourcesView = providers.map((p) => {
    const row = rowMap.get(p.id);
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      requiresApiKey: p.requiresApiKey,
      enabled: p.enabled,
      configured: p.configured,
      costPerRequestUsd: p.costPerRequestUsd,
      attributionNotice: p.attributionNotice,
      retentionPolicyDays: p.retentionPolicyDays,
      requests: row?.requests || 0,
      errors: row?.errors || 0,
      lastError: p.lastError,
    };
  });

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Radio className="w-5 h-5 text-cyan-400" />
          Discovery Sources &amp; Provider Health
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Pluggable provider adapters (Company Websites, Directories, Government Licensing Rolls, Optional Places, CSV Upload).
        </p>
      </div>

      <SourcesClient sources={sourcesView} />
    </div>
  );
}
