"use client";

import React, { useState } from "react";
import { X, CheckCircle2, ChevronDown, ChevronUp, Phone, PhoneCall } from "lucide-react";
import { CallOutcomePicker } from "@/components/call-status-ui";
import { type CallOutcomeKey, inferOutcomeFromText } from "@/server/domain/call-outcomes";
import { buildPresetFollowUpIso } from "@/components/crm-lead-sheet";

export interface CallLogLeadTarget {
  id?: string;
  companyId?: string;
  name: string;
  phone?: string | null;
  phoneDisplay?: string | null;
  bestContact?: {
    name?: string | null;
    title?: string | null;
    phone?: string | null;
  };
  nextFollowUp?: string | null;
  notes?: string | null;
  software?: string | null;
}

export interface CallLogSubmitData {
  outcome: CallOutcomeKey;
  callerNotes: string;
  followUpDate: string | null;
  softwareConfirmed?: string | null;
  fleetSizeConfirmed?: number | null;
}

export interface CallLogModalProps {
  lead: CallLogLeadTarget;
  activeActorName?: string;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (data: CallLogSubmitData) => void;
}

export const CallLogModal = React.memo(function CallLogModal({
  lead,
  activeActorName = "Sales Caller",
  isSubmitting = false,
  onClose,
  onSubmit,
}: CallLogModalProps) {
  // All modal input state is strictly local to avoid re-rendering heavy background CRM queues on keystrokes
  const [outcome, setOutcome] = useState<CallOutcomeKey | null>(null);
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState(lead.nextFollowUp || "");
  const detectedSoft = lead.software && lead.software !== "UNKNOWN" ? lead.software : "";
  const [confirmedSoftware, setConfirmedSoftware] = useState(detectedSoft);
  const [confirmedFleet, setConfirmedFleet] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const contactName = lead.bestContact?.name || "Owner / Decision Maker";
  const contactPhone = lead.bestContact?.phone || lead.phone || lead.phoneDisplay || "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcome) {
      setValidationError("Please select a call outcome before saving.");
      return;
    }

    const fleetNum = confirmedFleet.trim() ? parseInt(confirmedFleet.trim(), 10) : null;

    onSubmit({
      outcome,
      callerNotes: notes.trim(),
      followUpDate: followUpDate || null,
      softwareConfirmed: confirmedSoftware.trim() || null,
      fleetSizeConfirmed: fleetNum && !isNaN(fleetNum) ? fleetNum : null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="w-full max-w-xl bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[88vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-zinc-800 flex items-center justify-between gap-2 shrink-0 bg-[#121215]">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white truncate">
              Log Call: {lead.name}
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-zinc-400">
              <span className="font-medium text-zinc-300 truncate">{contactName}</span>
              {contactPhone && (
                <>
                  <span className="text-zinc-600">•</span>
                  <a
                    href={`tel:${contactPhone.replace(/\D/g, "")}`}
                    className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-mono transition"
                    title="Click to dial"
                  >
                    <Phone className="w-3 h-3" />
                    <span>{contactPhone}</span>
                  </a>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 shrink-0 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {validationError && (
          <div className="px-4 sm:px-6 py-2.5 text-xs flex items-center gap-2 border-b bg-rose-500/10 text-rose-300 border-rose-500/30 shrink-0">
            <span>{validationError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
            {/* Outcome Picker */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-2">
                What happened on this call? <span className="text-rose-400">*</span>
              </label>
              <CallOutcomePicker
                value={outcome}
                onChange={(k) => {
                  setOutcome(k);
                  if (validationError) setValidationError(null);
                }}
                disabled={isSubmitting}
              />
            </div>

            {/* Quick Follow-Up Scheduler */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
                <label className="block text-xs font-semibold text-zinc-300">
                  Schedule Next Follow-Up (Optional)
                </label>
                <div className="flex flex-wrap items-center gap-1">
                  {[
                    { label: "Later Today", preset: "LATER_TODAY" as const },
                    { label: "Tomorrow", preset: "TOMORROW" as const },
                    { label: "+2 Days", preset: "TWO_DAYS" as const },
                    { label: "Next Week", preset: "NEXT_WEEK" as const },
                  ].map((p) => (
                    <button
                      key={p.preset}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setFollowUpDate(buildPresetFollowUpIso(p.preset))}
                      className="rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-amber-300 hover:text-amber-200 transition"
                    >
                      {p.label}
                    </button>
                  ))}
                  {followUpDate && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setFollowUpDate("")}
                      className="rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400 hover:text-white transition"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <input
                type="datetime-local"
                value={followUpDate}
                disabled={isSubmitting}
                onChange={(e) => setFollowUpDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:outline-none focus:border-zinc-600 transition"
              />
            </div>

            {/* Call Notes Textarea (Local state - zero typing lag + real-time outcome detection) */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                <label className="block text-xs font-semibold text-zinc-300">
                  Call Notes (Summary or objections)
                </label>
                <span className="text-[10px] text-zinc-500">
                  Honest intent auto-detected
                </span>
              </div>
              <textarea
                rows={3}
                value={notes}
                disabled={isSubmitting}
                onChange={(e) => {
                  const val = e.target.value;
                  setNotes(val);
                  // Real-time honest outcome detection: if caller types "meeting booked", "gatekeeper", "voicemail", etc.
                  const detected = inferOutcomeFromText(val);
                  if (detected && (!outcome || outcome === "CONNECTED" || outcome === "NO_ANSWER")) {
                    setOutcome(detected);
                    if (validationError) setValidationError(null);
                  }
                }}
                placeholder="Summary of conversation (auto-detects meeting booked, gatekeeper blocked, voicemail, wrong number, not interested)..."
                className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 resize-y transition"
              />
            </div>

            {/* Collapsible Advanced CRM Fields */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 transition"
              >
                {showAdvanced ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span>
                  {showAdvanced
                    ? "Hide extra qualification fields"
                    : "Add current CRM/software or team size"}
                </span>
              </button>

              {showAdvanced && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5 p-3 rounded-lg bg-[#09090b] border border-zinc-800">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                      Software / Tools Used
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. HubSpot, Follow Up Boss, AppFolio"
                      value={confirmedSoftware}
                      disabled={isSubmitting}
                      onChange={(e) => setConfirmedSoftware(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-zinc-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                      Team Size / Doors Managed
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10000"
                      placeholder="e.g. 25"
                      value={confirmedFleet}
                      disabled={isSubmitting}
                      onChange={(e) => setConfirmedFleet(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white focus:outline-none focus:border-zinc-600"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-4 sm:px-6 py-3.5 border-t border-zinc-800 flex items-center justify-between gap-2 shrink-0 bg-[#121215]">
            <div className="text-[11px] text-zinc-500">
              Logged by: <span className="text-zinc-400 font-medium">{activeActorName}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-3.5 py-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !outcome}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black font-bold text-xs transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>{isSubmitting ? "Saving..." : "Save Call Log"}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
});
