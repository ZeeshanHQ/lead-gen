import React from "react";
import Link from "next/link";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { loadQualificationReport, type QualifiedLeadRow } from "@/server/repo/qualification";
import { COMPLETENESS_LABEL, resolveCompleteness } from "@/server/domain/completeness";
import { Download, SlidersHorizontal, XCircle } from "lucide-react";
import { ENRICHMENT_SOURCES } from "@/server/enrichment/pipeline";
import { EnrichBatchButton, EnrichLeadButton } from "./enrich-buttons";

export const dynamic = "force-dynamic";

const dash = <span className="text-slate-600">—</span>;

function LeadRowView({ l }: { l: QualifiedLeadRow }) {
  return (
    <tr className="border-t border-slate-800/80 hover:bg-slate-800/30 align-top transition-colors">
      <td className="px-3 py-2.5">
        <Link href={`/company/${l.id}`} className="font-semibold text-white hover:underline">
          {l.name}
        </Link>
        <div className="text-[11px] text-slate-500">{l.website ?? dash}</div>
      </td>
      <td className="px-3 py-2.5">
        <div className="text-slate-100 font-medium">{l.ownerName ?? dash}</div>
        <div className="text-[11px] text-slate-400">
          {l.ownerTitle ?? dash}
          {l.ownerVerified && <span className="ml-1 text-emerald-400">verified</span>}
        </div>
      </td>
      <td className="px-3 py-2.5 text-slate-200 font-mono">
        <div>{l.phone ?? dash}</div>
        {l.ownerPhone && <div className="text-[11px] text-slate-400">Direct: {l.ownerPhone}</div>}
      </td>
      <td className="px-3 py-2.5 text-slate-200">{l.ownerEmail ?? l.anyEmail ?? dash}</td>
      <td className="px-3 py-2.5 text-slate-300 text-xs">
        {[l.address, l.city, [l.state, l.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || dash}
      </td>
      <td className="px-3 py-2.5 text-center">
        <span className="font-semibold text-white">{l.qualification.score}</span>
        <span className="ml-1 text-[11px] text-slate-400">({l.qualification.grade})</span>
      </td>
    </tr>
  );
}

function Table({ rows }: { rows: QualifiedLeadRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-900/30">
      <table className="w-full text-xs text-left">
        <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[10px]">
          <tr>
            <th className="px-3 py-2.5">Company</th>
            <th className="px-3 py-2.5">Owner / Manager</th>
            <th className="px-3 py-2.5">Phone</th>
            <th className="px-3 py-2.5">Email</th>
            <th className="px-3 py-2.5">Address</th>
            <th className="px-3 py-2.5 text-center">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <React.Fragment key={l.id}>
              <LeadRowView l={l} />
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function QualifiedLeadsPage() {
  const db = await getDb();
  const { market } = await getActiveContext(db);
  const { leads, counts, rule, ruleName } = await loadQualificationReport(db, market.id);
  const completeness = resolveCompleteness(rule.completeness);
  const qualified = leads.filter((l) => l.tier === "QUALIFIED");
  const almost = leads.filter((l) => l.tier === "ALMOST");

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white">
            Qualified Leads — {market.name}
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Leads for <strong className="text-slate-200">{market.name}</strong> that pass your scoring rules and have all required contact details.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/rules"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-medium text-xs border border-slate-700/80 transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            Scoring Rules
          </Link>
          <a
            href="/api/export/qualified"
            download
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-white hover:bg-slate-200 text-slate-950 font-semibold text-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV ({counts.QUALIFIED})
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/40">
          <div className="text-xl font-semibold text-white">{counts.QUALIFIED}</div>
          <div className="text-slate-400 font-medium mt-0.5">Ready Leads</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/40">
          <div className="text-xl font-semibold text-white">{counts.ALMOST}</div>
          <div className="text-slate-400 font-medium mt-0.5">Missing Details</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/40">
          <div className="text-xl font-semibold text-white">{counts.REJECTED}</div>
          <div className="text-slate-400 font-medium mt-0.5">Filtered Out</div>
        </div>
      </div>

      <div className="p-3 rounded-lg border border-slate-800/80 bg-slate-900/30 text-[11px] text-slate-400 leading-relaxed">
        <strong className="text-slate-200">Active rule:</strong> {ruleName} · min score{" "}
        <strong className="text-slate-200">{rule.scoring.minScore}</strong> · required data:{" "}
        {completeness.requiredFields.length === 0
          ? "none"
          : completeness.requiredFields.map((f) => COMPLETENESS_LABEL[f]).join(", ")}
        {completeness.requireVerifiedOwner && " · owner must be verified"}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-white">Ready to Use ({qualified.length})</h2>
        {qualified.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-400">
            No fully qualified leads yet. Run research from Find Leads, or enrich the leads below.
          </div>
        ) : (
          <Table rows={qualified} />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-white">
          Needs Enrichment ({almost.length})
        </h2>
        <EnrichBatchButton count={almost.length} />
        {almost.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing waiting on missing data.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-900/30">
            <table className="w-full text-xs text-left">
              <tbody>
                {almost.map((l) => (
                  <tr key={l.id} className="border-t border-slate-800/80 first:border-t-0 align-top">
                    <td className="px-3 py-2.5 w-64">
                      <Link href={`/company/${l.id}`} className="font-semibold text-white hover:underline">
                        {l.name}
                      </Link>
                      <div className="text-[11px] text-slate-500">
                        {l.ownerName ? `${l.ownerName}${l.ownerTitle ? `, ${l.ownerTitle}` : ""}` : "No owner found yet"}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {l.qualification.missing.map((m) => (
                          <span key={m} className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700/80">
                            Missing: {m}
                          </span>
                        ))}
                        {l.qualification.needsResearch.map((m) => (
                          <span key={m} className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700/80">
                            Needs research: {m}
                          </span>
                        ))}
                        {l.qualification.score < l.qualification.minScore && (
                          <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                            Score {l.qualification.score}/{l.qualification.minScore}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 w-72 text-right text-slate-400 space-y-2">
                      <div>{l.qualification.completeness.pct}% complete</div>
                      <EnrichLeadButton companyId={l.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="rounded-xl border border-slate-800/80 bg-slate-900/30 p-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-200">
          Public Enrichment Sources ({ENRICHMENT_SOURCES.length})
        </summary>
        <ul className="mt-2 space-y-2 text-slate-400">
          {ENRICHMENT_SOURCES.map((s) => (
            <li key={s.meta.id}>
              <span className="text-slate-200 font-medium">{s.meta.name}</span>: {s.meta.description}
              <div className="text-[11px] text-slate-500">Provides: {s.meta.provides.join(", ")}</div>
            </li>
          ))}
        </ul>
      </details>

      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <XCircle className="w-3.5 h-3.5" />
        {counts.REJECTED} lead(s) did not match your scoring filters.
      </p>
    </div>
  );
}
