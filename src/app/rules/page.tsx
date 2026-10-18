import React from "react";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { RuleEditor } from "./rule-editor";
import { resolveCompleteness } from "@/server/domain/completeness";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const db = await getDb();
  const { market, rule: defaultRule } = await getActiveContext(db);

  if (!defaultRule) {
    return (
      <div className="p-8 text-center text-slate-400 text-xs">
        No scoring rules found in database.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <h1 className="text-lg font-semibold text-white">
          Scoring Rules — {market.name}
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Set how leads are scored and filtered for <strong className="text-slate-200">{market.name}</strong>.
        </p>
      </div>

      <RuleEditor
        key={defaultRule.id}
        rule={
          {
            ...defaultRule,
            config: {
              ...(defaultRule.config as object),
              completeness: resolveCompleteness((defaultRule.config as { completeness?: unknown }).completeness as never),
            },
          } as never
        }
      />
    </div>
  );
}
