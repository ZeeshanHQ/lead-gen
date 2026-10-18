"use client";

import React, { useState, useTransition } from "react";
import { importLeadsAction } from "@/app/actions/import";
import { parseDelimitedText, mapRowsToLeads, type RawLeadRow } from "@/server/repo/bulk-import";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  X,
  FileText,
  Clipboard,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";

interface LeadImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess?: () => void;
}

export function LeadImportModal({ isOpen, onClose, onImportSuccess }: LeadImportModalProps) {
  const [activeTab, setActiveTab] = useState<"PASTE" | "FILE">("PASTE");
  const [rawText, setRawText] = useState("");
  const [targetStage, setTargetStage] = useState<"APPROVED" | "NEEDS_REVIEW">("APPROVED");
  const [actor, setActor] = useState("Astraventa User");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedPreview, setParsedPreview] = useState<RawLeadRow[]>([]);
  const [totalParsedCount, setTotalParsedCount] = useState(0);
  const [phoneDetectedCount, setPhoneDetectedCount] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    success: boolean;
    importedCount?: number;
    duplicatesCount?: number;
    invalidCount?: number;
    error?: string;
  } | null>(null);

  if (!isOpen) return null;

  const updatePreview = (text: string) => {
    setRawText(text);
    setResult(null);
    if (!text.trim()) {
      setParsedPreview([]);
      setTotalParsedCount(0);
      setPhoneDetectedCount(0);
      setPreviewError(null);
      return;
    }

    try {
      const matrix = parseDelimitedText(text);
      if (matrix.length === 0) {
        setPreviewError("No content detected in clipboard text.");
        setParsedPreview([]);
        setTotalParsedCount(0);
        setPhoneDetectedCount(0);
        return;
      }
      const leads = mapRowsToLeads(matrix);
      setTotalParsedCount(leads.length);
      const withPhones = leads.filter((l) => Boolean(l.phone || l.contactPhone)).length;
      setPhoneDetectedCount(withPhones);
      setParsedPreview(leads.slice(0, 5));
      setPreviewError(leads.length === 0 ? "Could not detect leads. Please ensure company names or rows are present." : null);
    } catch (e: any) {
      setPreviewError("Could not parse data format.");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        updatePreview(content);
      }
    };
    reader.readAsText(file);
  };

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawText.trim()) return;

    startTransition(async () => {
      const res = await importLeadsAction(rawText, {
        targetStage,
        actor,
        sourceName: fileName || "google_sheet_paste",
      });

      if (res.success) {
        setResult({
          success: true,
          importedCount: res.importedCount,
          duplicatesCount: res.duplicatesCount,
          invalidCount: res.invalidCount,
        });
        if (onImportSuccess) {
          onImportSuccess();
        }
      } else {
        setResult({
          success: false,
          error: res.error,
        });
      }
    });
  };

  const sampleTemplate = `Company Name,Phone,Website,City,State,Decision Maker,Title
Metro Air Solutions,(214) 765-4321,https://metroairpros.com,Dallas,TX,Robert Davis,Owner
Lone Star Heating & Air,(512) 887-3322,https://lonestarhvac.com,Austin,TX,Sarah Jenkins,President`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-950 border border-emerald-800 text-emerald-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                Import External Lead Spreadsheet
              </h2>
              <p className="text-xs text-slate-400">
                Upload CSV or paste rows directly from Google Sheets / Excel
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 px-4 pt-2 gap-2 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("PASTE")}
            className={`pb-2.5 px-3 flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === "PASTE"
                ? "border-emerald-400 text-emerald-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Clipboard className="w-3.5 h-3.5" />
            <span>Copy-Paste from Google Sheets</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("FILE")}
            className={`pb-2.5 px-3 flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === "FILE"
                ? "border-emerald-400 text-emerald-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload CSV / TSV File</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleImportSubmit} className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Success or Error Result Banner */}
          {result && (
            <div
              className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                result.success
                  ? "bg-emerald-950/70 border-emerald-800 text-emerald-200"
                  : "bg-rose-950/70 border-rose-800 text-rose-200"
              }`}
            >
              {result.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
              )}
              <div className="space-y-1">
                {result.success ? (
                  <>
                    <p className="font-bold text-emerald-300">
                      Import completed successfully!
                    </p>
                    <p className="text-[11px] text-emerald-400">
                      &bull; <strong>{result.importedCount}</strong> new leads added to CRM &bull;{" "}
                      <strong>{result.duplicatesCount}</strong> duplicates merged/skipped &bull;{" "}
                      <strong>{result.invalidCount}</strong> invalid rows.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-bold text-rose-300">Import Error</p>
                    <p className="text-[11px]">{result.error}</p>
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === "PASTE" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-300">
                  Paste rows directly from your Google Sheet or Excel (with headers):
                </label>
                <button
                  type="button"
                  onClick={() => updatePreview(sampleTemplate)}
                  className="text-[10px] text-cyan-400 hover:underline"
                >
                  Load Sample Template
                </button>
              </div>
              <textarea
                rows={6}
                value={rawText}
                onChange={(e) => updatePreview(e.target.value)}
                placeholder="Company Name&#9;Phone&#9;Website&#9;City&#9;State&#9;Decision Maker&#10;Metro Air Pros&#9;(214) 765-4321&#9;metroairpros.com&#9;Dallas&#9;TX&#9;Robert Davis"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 font-mono text-[11px] placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 leading-relaxed"
              />
              <span className="text-[10px] text-slate-500 block">
                Tip: In Google Sheets, select your columns and rows, press <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-300">Ctrl+C</kbd>, and paste here with <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-300">Ctrl+V</kbd>.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="font-semibold text-slate-300">
                Choose CSV or TSV File:
              </label>
              <div className="p-6 rounded-xl border-2 border-dashed border-slate-800 bg-slate-950/60 text-center hover:border-emerald-500/50 transition-colors">
                <Upload className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="csv-file-input"
                />
                <label
                  htmlFor="csv-file-input"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs cursor-pointer transition-colors"
                >
                  <FileText className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{fileName || "Select .csv or .tsv file"}</span>
                </label>
                <p className="text-[11px] text-slate-500 mt-2">
                  Exports from Google Sheets, Microsoft Excel, or Apollo supported.
                </p>
              </div>
            </div>
          )}

          {/* Import Destination Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block font-semibold text-slate-300 mb-1">
                Import Destination:
              </label>
              <select
                value={targetStage}
                onChange={(e) => setTargetStage(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="APPROVED">Direct to Approved CRM &amp; Caller Queue (Ready to Call)</option>
                <option value="NEEDS_REVIEW">To Review Queue (Inspect &amp; Score First)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-300 mb-1">
                Recorded Importer Name:
              </label>
              <input
                type="text"
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Parsed Preview Table */}
          {parsedPreview.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-400 uppercase tracking-wider">
                  Detected Leads Preview (Showing {parsedPreview.length} of {totalParsedCount}):
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-bold flex items-center gap-1 text-[10px]">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  {phoneDetectedCount} of {totalParsedCount} phones detected
                </span>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950">
                <table className="w-full text-[11px] text-left text-slate-300 divide-y divide-slate-800">
                  <thead className="bg-slate-900 text-slate-400">
                    <tr>
                      <th className="px-2.5 py-1.5">Company</th>
                      <th className="px-2.5 py-1.5">Phone Number</th>
                      <th className="px-2.5 py-1.5">Website</th>
                      <th className="px-2.5 py-1.5">Location</th>
                      <th className="px-2.5 py-1.5">Decision Maker</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {parsedPreview.map((lead, i) => (
                      <tr key={i}>
                        <td className="px-2.5 py-1.5 font-bold text-white">{lead.name}</td>
                        <td className="px-2.5 py-1.5">
                          {lead.phone ? (
                            <span className="font-mono text-cyan-300 font-semibold px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/50">
                              {lead.phone}
                            </span>
                          ) : (
                            <span className="text-amber-400/80 italic text-[10px]">No phone</span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 text-slate-400 truncate max-w-[140px]">
                          {lead.website ? (
                            <span className="text-sky-400 truncate">{lead.website.replace(/^https?:\/\//i, "")}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 text-slate-400">
                          {lead.city || "—"}{lead.state ? `, ${lead.state}` : ""}
                        </td>
                        <td className="px-2.5 py-1.5 text-emerald-300">
                          {lead.contactName ? `${lead.contactName} (${lead.contactTitle || "Owner"})` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {previewError && (
            <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-800 text-[11px] text-amber-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{previewError}</span>
            </div>
          )}

          {/* Modal Footer */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isPending || !rawText.trim() || parsedPreview.length === 0}
              className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow-md shadow-emerald-950 transition-all flex items-center gap-1.5 disabled:opacity-40"
            >
              {isPending ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Importing Leads...
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  Import Leads to CRM
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
