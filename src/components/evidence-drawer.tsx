"use client";

import React, { useEffect, useState } from "react";
import { fetchEvidenceDrawerAction } from "@/app/review/actions";
import { ProvenanceBadge } from "@/components/badges";
import { formatDateTime } from "@/lib/utils";
import {
  X,
  FileText,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  HelpCircle,
  Clock,
  Sparkles,
} from "lucide-react";

interface EvidenceDrawerProps {
  companyId: string | null;
  onClose: () => void;
}

export function EvidenceDrawer({ companyId, onClose }: EvidenceDrawerProps) {
  const [drawerData, setDrawerData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setDrawerData(null);
      return;
    }

    setLoading(true);
    setError(null);
    fetchEvidenceDrawerAction(companyId)
      .then((res) => {
        if (res.ok) setDrawerData(res.drawer);
        else setError(res.error || "Failed to load evidence drawer");
      })
      .finally(() => setLoading(false));
  }, [companyId]);

  if (!companyId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-slate-950 border-l border-slate-800 h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" />
              <h2 className="text-base font-bold text-white">Evidence &amp; Verification Audit</h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {drawerData ? drawerData.name : "Loading company claims..."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading && (
            <div className="py-12 text-center text-xs text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p>Retrieving auditable evidence records...</p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-lg bg-rose-950/80 text-rose-300 border border-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              {error}
            </div>
          )}

          {drawerData && !loading && (
            <>
              {/* Evidence summary bar */}
              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-400">Total Audited Claims: </span>
                  <span className="font-bold text-cyan-300">{drawerData.total}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Zero Hallucinations Guarantee</span>
                </div>
              </div>

              {/* Claims / Facts list */}
              <div className="space-y-4">
                {drawerData.facts.map((fact: any) => (
                  <div
                    key={fact.field}
                    className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3"
                  >
                    {/* Plain-English question heading */}
                    <div className="border-b border-slate-800/60 pb-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono text-cyan-400 uppercase tracking-wider">
                          {fact.label}
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded ${
                              fact.value === "YES"
                                ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                                : fact.value === "NO"
                                ? "bg-zinc-900 text-zinc-400 border border-zinc-800"
                                : fact.value === "CONFLICTING"
                                ? "bg-orange-950 text-orange-300 border border-orange-800"
                                : "bg-slate-900 text-slate-400 border border-slate-800"
                            }`}
                          >
                            {fact.value}
                          </span>
                          {fact.confidence !== null && (
                            <span className="text-[11px] font-medium text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                              {(fact.confidence * 100).toFixed(0)}% conf
                            </span>
                          )}
                        </div>
                      </div>
                      <h4 className="text-xs font-semibold text-slate-200 mt-1">
                        &ldquo;{fact.question}&rdquo;
                      </h4>
                    </div>

                    {/* Actual Evidence Snippets & Source */}
                    {fact.evidence.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">
                        No supporting public or human evidence has been recorded for this field. (Reported honestly as UNKNOWN)
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {fact.evidence.map((ev: any) => (
                          <div
                            key={ev.id}
                            className={`p-3 rounded-lg text-xs space-y-2 border ${
                              ev.status === "ACTIVE"
                                ? "bg-slate-950 border-slate-800"
                                : "bg-slate-950/40 border-slate-900 text-slate-500 line-through"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <ProvenanceBadge provenance={ev.provenance} />
                              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                <Clock className="w-3 h-3 text-slate-500" />
                                <span>{formatDateTime(ev.retrievedAt)}</span>
                              </div>
                            </div>

                            {/* Evidence Quote */}
                            <blockquote className="border-l-2 border-cyan-500/60 pl-2.5 text-slate-300 italic text-xs leading-relaxed bg-slate-900/40 py-1">
                              &ldquo;{ev.text}&rdquo;
                            </blockquote>

                            {/* Source URL & Type */}
                            <div className="flex items-center justify-between text-[11px] pt-1">
                              <span className="text-slate-400 capitalize">
                                Source: {ev.sourceType.replace(/_/g, " ")}
                              </span>
                              {ev.sourceUrl && (
                                <a
                                  href={ev.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 hover:underline max-w-[280px] truncate"
                                >
                                  <span className="truncate">{ev.sourceUrl}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
