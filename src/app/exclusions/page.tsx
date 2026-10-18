import React from "react";
import { getDb } from "@/server/db/client";
import { listExclusions } from "@/server/repo/exclusions";
import { ExclusionManager } from "./exclusion-manager";
import { ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ExclusionsPage() {
  const db = await getDb();
  const exclusions = await listExclusions(db);

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-400" />
          Exclusions &amp; Blocklist
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Block known franchises, aggregators, unserviceable states, or competitors. Evaluated automatically during intake.
        </p>
      </div>

      <ExclusionManager initialExclusions={exclusions} />
    </div>
  );
}
