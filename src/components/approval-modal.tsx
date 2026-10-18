"use client";

import React, { useEffect, useState } from "react";
import { fetchApprovalSummaryAction, approveLeadAction } from "@/app/review/actions";
import { ProvenanceBadge, ContactQualityBadge, ContactGradeBadge } from "@/components/badges";
import {
  X,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  User,
  Phone,
  FileText,
  AlertCircle,
} from "lucide-react";

interface ApprovalModalProps {
  companyId: string | null;
  onClose: () => void;
  onApproved: () => void;
}

export function ApprovalModal({ companyId, onClose, onApproved }: ApprovalModalProps) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [note, setNote] = useState("");
  const [ackUnresearched, setAckUnresearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setSummary(null);
      return;
    }

    setLoading(true);
    setError(null);
    fetchApprovalSummaryAction(companyId)
      .then((res) => {
        if (res.ok) setSummary(res.summary);
        else setError(res.error || "Failed to load approval snapshot");
      })
      .finally(() => setLoading(false));
  }, [companyId]);

  if (!companyId) return null;

  const handleApprove = async () => {
    setApproving(true);
    setError(null);
    const res = await approveLeadAction(companyId, note, ackUnresearched);
    setApproving(false);
    if (res.ok) {
      onApproved();
      onClose();
    } else {
      setError(res.error || "Approval failed.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-bold text-white">Approval Safety Gate</h2>
              <p className="text-xs text-slate-400">
                Approving grants eligibility for outbound cold calling and Google Sheets sync.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {loading && (
            <div className="py-12 text-center text-slate-400">
              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
              Loading auditable snapshot...
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-lg bg-rose-950/80 text-rose-300 border border-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {summary && !loading && (
            <>
              {/* Warnings / Flags */}
              {summary.warnings.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/80 space-y-2">
                  <div className="flex items-center gap-2 text-amber-300 font-semibold">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Review Flags for Caller Attention:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-amber-200/90 pl-1">
                    {summary.warnings.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 1. Account & Scoring Profile */}
              <div className="grid grid-cols-2 gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/50">
                <div>
                  <span className="text-slate-400 block text-[11px]">Company</span>
                  <p className="font-bold text-white text-sm mt-0.5">{summary.company.name}</p>
                  <p className="text-slate-400 mt-0.5">
                    {summary.company.city ?? "No City"}, {summary.company.state ?? "No State"}
                  </p>
                </div>

                <div className="flex items-center justify-end gap-4 text-right">
                  <div>
                    <span className="text-slate-400 block text-[11px]">ICP Score</span>
                    <span className="text-xl font-extrabold text-cyan-300">
                      {summary.icpScore ?? "--"}/100
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Confidence</span>
                    <span className="text-xl font-extrabold text-indigo-300">
                      {summary.researchConfidence ?? "--"}%
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. Best Available Contact Snapshot */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-semibold text-slate-200 flex items-center gap-2">
                    <User className="w-4 h-4 text-cyan-400" />
                    Best Available Decision-Maker Contact
                  </span>
                  <div className="flex items-center gap-2">
                    <ContactGradeBadge grade={summary.bestContact.grade} />
                    <ContactQualityBadge label={summary.bestContact.label} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Identified Decision Maker</span>
                    <p className="font-medium text-slate-200 mt-0.5">
                      {summary.bestContact.name ?? "None Identified"}
                    </p>
                    <span className="text-slate-400 text-[11px]">
                      {summary.bestContact.title ?? "Direct phone: NOT FOUND"}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[11px]">Phone to Dial</span>
                    <p className="font-bold text-cyan-300 mt-0.5 flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-cyan-400" />
                      {summary.bestContact.phone ?? summary.company.phone ?? "NOT FOUND"}
                    </p>
                    <span className="text-[11px] text-slate-400">
                      {summary.bestContact.reason}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Top Evidence Snippets & Sources */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    Top Audited Evidence ({summary.evidenceCount} total)
                  </span>
                  <span>{summary.sourceUrls.length} verified URL(s)</span>
                </div>

                <div className="space-y-2">
                  {summary.topEvidence.map((ev: any, i: number) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-cyan-400 text-[11px] uppercase">
                          {ev.field}: <span className="font-bold text-white">{ev.value}</span>
                        </span>
                        <ProvenanceBadge provenance={ev.provenance} />
                      </div>
                      <blockquote className="text-slate-300 italic border-l-2 border-cyan-500 pl-2">
                        &ldquo;{ev.text}&rdquo;
                      </blockquote>
                      {ev.sourceUrl && (
                        <div className="text-[10px] text-slate-400 truncate">
                          URL: <span className="text-cyan-400">{ev.sourceUrl}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Unresearched acknowledgement */}
              {summary.unresearched && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-200 space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ackUnresearched}
                      onChange={(e) => setAckUnresearched(e.target.checked)}
                      className="mt-0.5 accent-rose-500"
                    />
                    <span>
                      <strong>Warning:</strong> No public crawl evidence exists yet. I acknowledge I am approving this lead based on manually submitted data alone.
                    </span>
                  </label>
                </div>
              )}

              {/* Reviewer Note */}
              <div>
                <label className="text-slate-400 block mb-1">
                  Approval Audit Note (Optional)
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Verified residential replacement focus via service page; ready for cold caller."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleApprove}
            disabled={
              loading ||
              approving ||
              (summary?.unresearched && !ackUnresearched) ||
              summary?.excluded
            }
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-md transition-all"
          >
            <CheckCircle2 className="w-4 h-4" />
            {approving ? "Recording Approval..." : "Approve Lead for Outbound"}
          </button>
        </div>
      </div>
    </div>
  );
}
