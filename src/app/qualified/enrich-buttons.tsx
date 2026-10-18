"use client";

import React, { useState, useTransition } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { enrichBatchAction, enrichLeadAction, type EnrichActionResult } from "./actions";
import type { EnrichmentReport } from "@/server/enrichment/pipeline";

function ReportView({ r }: { r: EnrichmentReport }) {
  const stored = r.sources.flatMap((s) => s.applied.map((a) => ({ a, src: s.name })));
  return (
    <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/70 text-[11px] space-y-1.5">
      <div className="font-semibold text-slate-100">
        {r.name}: {r.tierBefore} → <span className={r.tierAfter === "QUALIFIED" ? "text-emerald-400" : "text-amber-300"}>{r.tierAfter}</span>
      </div>
      {stored.length === 0 ? (
        <div className="text-slate-400">No new verifiable data found in the free sources.</div>
      ) : (
        <ul className="list-disc ml-4 text-slate-300">
          {stored.map((x, i) => (
            <li key={i}>
              {x.a} <span className="text-slate-500">via {x.src}</span>
            </li>
          ))}
        </ul>
      )}
      {r.missingAfter.length > 0 && <div className="text-amber-300">Still missing: {r.missingAfter.join(", ")}</div>}
      {r.sources.some((s) => s.status === "error") && (
        <div className="text-rose-300">
          Source errors: {r.sources.filter((s) => s.status === "error").map((s) => `${s.name} (${s.error})`).join("; ")}
        </div>
      )}
      {r.note && <div className="text-slate-500">{r.note}</div>}
    </div>
  );
}

function useEnrich() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<EnrichActionResult | null>(null);
  const run = (fn: () => Promise<EnrichActionResult>) => start(async () => setResult(await fn()));
  return { pending, result, run };
}

const btn =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-950 font-bold text-xs shadow-md";

export function EnrichLeadButton({ companyId }: { companyId: string }) {
  const { pending, result, run } = useEnrich();
  return (
    <div className="space-y-2">
      <button className={btn} disabled={pending} onClick={() => run(() => enrichLeadAction(companyId))}>
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
        Auto-find missing data
      </button>
      {result?.ok === false && <div className="text-rose-300 text-[11px]">{result.error}</div>}
      {result?.ok && result.reports.map((r) => <ReportView key={r.companyId} r={r} />)}
    </div>
  );
}

export function EnrichBatchButton({ count }: { count: number }) {
  const { pending, result, run } = useEnrich();
  return (
    <div className="space-y-2">
      <button className={btn} disabled={pending || count === 0} onClick={() => run(() => enrichBatchAction(5))}>
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
        {pending ? "Searching free sources…" : "Auto-complete next 5"}
      </button>
      {result?.ok === false && <div className="text-rose-300 text-[11px]">{result.error}</div>}
      {result?.ok && result.reports.length === 0 && <div className="text-slate-400 text-[11px]">No almost-qualified leads with a website to enrich.</div>}
      {result?.ok && (
        <div className="space-y-2 max-w-xl">
          {result.reports.map((r) => (
            <ReportView key={r.companyId} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
