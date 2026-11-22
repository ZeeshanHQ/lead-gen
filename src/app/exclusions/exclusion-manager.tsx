"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addExclusionAction,
  removeExclusionAction,
  acceptDncSuggestionAction,
  dismissDncSuggestionAction,
} from "./actions";
import { type ExclusionRule, type ExclusionKind, EXCLUSION_KINDS } from "@/server/domain/rules";
import type { DncSuggestionRecord } from "@/server/repo/dnc-suggestions";
import {
  ShieldAlert,
  Trash2,
  Plus,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  X,
  PhoneCall,
  Globe,
  Building2,
  Sparkles,
} from "lucide-react";

interface ExclusionManagerProps {
  initialExclusions: ExclusionRule[];
  initialPendingDnc?: DncSuggestionRecord[];
}

export function ExclusionManager({
  initialExclusions,
  initialPendingDnc = [],
}: ExclusionManagerProps) {
  const router = useRouter();
  const [kind, setKind] = useState<string>("domain");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 5: Pending DNC suggestions state
  const [pendingDnc, setPendingDnc] = useState<DncSuggestionRecord[]>(initialPendingDnc);
  const [processingDncId, setProcessingDncId] = useState<string | null>(null);
  const [dncOverrides, setDncOverrides] = useState<Record<string, { kind: ExclusionKind; value: string }>>({});

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await addExclusionAction(kind, value, reason);
    setSaving(false);
    if (res.ok) {
      setValue("");
      setReason("");
      router.refresh();
    } else {
      setError(res.error || "Failed to add exclusion");
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm("Are you sure you want to remove this exclusion?")) return;
    await removeExclusionAction(id);
    router.refresh();
  };

  const handleAcceptDnc = async (s: DncSuggestionRecord) => {
    setProcessingDncId(s.id);
    setError(null);
    const override = dncOverrides[s.id];
    const res = await acceptDncSuggestionAction(s.id, override);
    setProcessingDncId(null);
    if (res.ok) {
      setPendingDnc((prev) => prev.filter((item) => item.id !== s.id));
      router.refresh();
    } else {
      setError(res.error || "Failed to accept DNC suggestion");
    }
  };

  const handleDismissDnc = async (id: string) => {
    setProcessingDncId(id);
    setError(null);
    const res = await dismissDncSuggestionAction(id);
    setProcessingDncId(null);
    if (res.ok) {
      setPendingDnc((prev) => prev.filter((item) => item.id !== id));
      router.refresh();
    } else {
      setError(res.error || "Failed to dismiss DNC suggestion");
    }
  };

  const setTargetKindForSuggestion = (
    s: DncSuggestionRecord,
    newKind: ExclusionKind
  ) => {
    let newValue = s.suggestedValue;
    if (newKind === "phone" && s.phone) {
      newValue = s.phone;
    } else if (newKind === "domain" && s.domain) {
      newValue = s.domain;
    } else if (newKind === "name") {
      newValue = s.companyName;
    }
    setDncOverrides((prev) => ({
      ...prev,
      [s.id]: { kind: newKind, value: newValue },
    }));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Phase 5: Pending DNC Suggestions Section */}
      {pendingDnc.length > 0 && (
        <div className="p-5 rounded-xl border border-rose-800/80 bg-gradient-to-br from-rose-950/40 via-slate-900/90 to-slate-900 border-dashed space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-rose-800/50 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <ShieldAlert className="w-5 h-5 animate-pulse" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Pending Do Not Call (DNC) Requests
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500 text-white font-extrabold">
                    {pendingDnc.length} Action Needed
                  </span>
                </h3>
                <p className="text-[11px] text-rose-300/80">
                  Callers logged explicit Do Not Call language. Confirm with 1 click to permanently block.
                </p>
              </div>
            </div>
            <span className="text-[10px] text-slate-400 font-mono hidden sm:inline-block">
              Auto-detected via NLP
            </span>
          </div>

          <div className="space-y-3">
            {pendingDnc.map((s) => {
              const currentKind = dncOverrides[s.id]?.kind || s.suggestedKind;
              const currentValue = dncOverrides[s.id]?.value || s.suggestedValue;
              const isProcessing = processingDncId === s.id;

              return (
                <div
                  key={s.id}
                  className="p-4 rounded-xl border border-rose-900/40 bg-slate-950/80 space-y-3 hover:border-rose-700/60 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-100 text-sm">{s.companyName}</span>
                        {s.detectedKeyword && (
                          <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800/60 text-[10px] font-mono">
                            Trigger: &ldquo;{s.detectedKeyword}&rdquo;
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap">
                        {s.phone && (
                          <span className="inline-flex items-center gap-1 font-mono text-slate-300">
                            <PhoneCall className="w-3 h-3 text-cyan-400" />
                            {s.phone}
                          </span>
                        )}
                        {s.domain && (
                          <span className="inline-flex items-center gap-1 font-mono text-slate-300">
                            <Globe className="w-3 h-3 text-cyan-400" />
                            {s.domain}
                          </span>
                        )}
                        <span>&bull; Reported by <strong className="text-slate-200">{s.suggestedBy}</strong></span>
                        <span>&bull; {new Date(s.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAcceptDnc(s)}
                        disabled={isProcessing}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                        title="Add to permanent blocklist"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        {isProcessing ? "Blocking..." : "1-Click Confirm & Block"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDismissDnc(s.id)}
                        disabled={isProcessing}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                        title="Dismiss without blocking"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {s.callerNotes && (
                    <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] text-slate-300 italic">
                      &ldquo;{s.callerNotes}&rdquo;
                    </div>
                  )}

                  {/* Exclusion target selector */}
                  <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-400">
                    <span className="shrink-0 text-slate-400">Exclusion Rule:</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {s.phone && (
                        <button
                          type="button"
                          onClick={() => setTargetKindForSuggestion(s, "phone")}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                            currentKind === "phone"
                              ? "bg-cyan-500 text-slate-950 shadow"
                              : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                          }`}
                        >
                          PHONE: {s.phone}
                        </button>
                      )}
                      {s.domain && (
                        <button
                          type="button"
                          onClick={() => setTargetKindForSuggestion(s, "domain")}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                            currentKind === "domain"
                              ? "bg-cyan-500 text-slate-950 shadow"
                              : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                          }`}
                        >
                          DOMAIN: {s.domain}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setTargetKindForSuggestion(s, "name")}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                          currentKind === "name"
                            ? "bg-cyan-500 text-slate-950 shadow"
                            : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                        }`}
                      >
                        NAME: {s.companyName}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Exclusion Form */}
      <form
        onSubmit={handleAdd}
        className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4 text-xs"
      >
        <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2 flex items-center gap-2">
          <Plus className="w-4 h-4 text-cyan-400" />
          Add Manual Exclusion Rule
        </h3>

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/80 text-rose-300 border border-rose-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-slate-400 block mb-1">Exclusion Type</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
            >
              {EXCLUSION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.toUpperCase()} (e.g. {k === "domain" ? "example.com" : k === "name" ? "Acme Air" : k === "phone" ? "2145550100" : "AK"})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Value to Exclude</label>
            <input
              type="text"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === "domain" ? "badco.com" : kind === "name" ? "Spam HVAC LLC" : kind === "phone" ? "(214) 555-0100" : "AK"}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Reason (Optional)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. DNC request, competitor, commercial"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={saving || !value.trim()}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-md transition-all cursor-pointer"
          >
            <ShieldAlert className="w-4 h-4" />
            {saving ? "Adding..." : "Add Exclusion"}
          </button>
        </div>
      </form>

      {/* Exclusions List */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            Active Exclusions ({initialExclusions.length})
          </h3>
          <span className="text-xs text-slate-400">
            Candidates matching these rules are rejected during discovery intake.
          </span>
        </div>

        {initialExclusions.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No exclusions configured. All valid contractors can be evaluated.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60 text-xs">
            {initialExclusions.map((item) => (
              <div
                key={item.id}
                className="p-3.5 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-slate-800 text-rose-300 uppercase font-bold border border-slate-700">
                    {item.kind}
                  </span>
                  <span className="font-semibold text-slate-100 text-sm font-mono">{item.value}</span>
                  {item.reason && (
                    <span className="text-slate-400 text-xs italic">&mdash; &ldquo;{item.reason}&rdquo;</span>
                  )}
                </div>

                <button
                  onClick={() => handleRemove(item.id)}
                  className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Remove Exclusion"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
