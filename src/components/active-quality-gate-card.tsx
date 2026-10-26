"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  SlidersHorizontal,
  X,
  Check,
  Loader2,
  Users,
  MapPin,
  Search,
  CheckCircle2,
} from "lucide-react";
import { updateRuleTargetingAction } from "@/app/discover/actions";
import { GATE_FIELDS, GATE_META, resolveGate, type LeadGate, type GateField } from "@/server/domain/gate";

interface ActiveQualityGateCardProps {
  marketId: string;
  marketName: string;
  marketKeywords?: string[];
  initialRuleConfig: any;
  canEditRules: boolean;
  /** If true, renders only the compact trigger button (for /caller workbench header) */
  compactTriggerOnly?: boolean;
}

export function ActiveQualityGateCard({
  marketId,
  marketName,
  marketKeywords = [],
  initialRuleConfig = {},
  canEditRules,
  compactTriggerOnly = false,
}: ActiveQualityGateCardProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form State
  const [minScore, setMinScore] = useState<number>(
    initialRuleConfig?.scoring?.minScore ?? 60
  );
  const [keywords, setKeywords] = useState<string>(
    initialRuleConfig?.discovery?.keywords?.length
      ? initialRuleConfig.discovery.keywords.join(", ")
      : marketKeywords.length
      ? marketKeywords.join(", ")
      : marketName
  );
  const [states, setStates] = useState<string>(
    initialRuleConfig?.geography?.states?.length
      ? initialRuleConfig.geography.states.join(", ")
      : "TX"
  );
  const [cities, setCities] = useState<string>(
    initialRuleConfig?.geography?.cities?.length
      ? initialRuleConfig.geography.cities.join(", ")
      : ""
  );
  const [minEmployees, setMinEmployees] = useState<number | null>(
    initialRuleConfig?.size?.minEmployees ?? null
  );
  const [maxEmployees, setMaxEmployees] = useState<number | null>(
    initialRuleConfig?.size?.maxEmployees ?? null
  );
  const [minDoors, setMinDoors] = useState<number | null>(
    initialRuleConfig?.size?.minDoors ?? null
  );
  const [gate, setGate] = useState<LeadGate>(() =>
    resolveGate(initialRuleConfig?.gate)
  );

  const toggleGateField = (field: GateField) => {
    setGate((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleSave = () => {
    setErrorMsg(null);
    setSuccessBanner(null);

    const statesArr = states.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const citiesArr = cities.split(",").map((c) => c.trim()).filter(Boolean);
    const kwsArr = keywords.split(",").map((k) => k.trim()).filter(Boolean);

    startTransition(async () => {
      try {
        const res = await updateRuleTargetingAction({
          states: statesArr.length > 0 ? statesArr : ["TX"],
          cities: citiesArr,
          minScore,
          keywords: kwsArr,
          gate,
          minEmployees,
          maxEmployees,
          minDoors,
        });

        if (res.ok) {
          setSuccessBanner("Targeting & Quality Gate updated successfully!");
          setTimeout(() => {
            setIsOpen(false);
            setSuccessBanner(null);
            router.refresh();
          }, 1000);
        } else {
          setErrorMsg(res.error || "Failed to update quality gate rules.");
        }
      } catch (err: any) {
        setErrorMsg(err.message || "An unexpected error occurred.");
      }
    });
  };

  // Keywords list for display
  const activeKeywords = keywords.split(",").map((k) => k.trim()).filter(Boolean);

  const modalElement = isOpen ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-xl rounded-2xl bg-[#0e0e11] border border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Edit Quality Gate &amp; Targeting</h3>
              <p className="text-[11px] text-zinc-400">
                Live targeting and strict CRM entry criteria for <span className="text-zinc-200 font-medium">{marketName}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto text-xs">
          {successBanner && (
            <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successBanner}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-500/30 text-rose-300 text-xs">
              {errorMsg}
            </div>
          )}

          {/* 1. Target Keywords */}
          <div className="space-y-1.5">
            <label className="text-zinc-300 font-medium flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-zinc-400" />
              <span>Target Search Keywords (Comma-separated)</span>
            </label>
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. real estate company, property management, commercial broker"
              className="w-full bg-[#141418] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          {/* 2. States & Cities */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <label className="text-zinc-300 font-medium flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-zinc-400" />
                <span>Target States (Codes)</span>
              </label>
              <input
                type="text"
                value={states}
                onChange={(e) => setStates(e.target.value)}
                placeholder="e.g. TX, FL, GA, CA"
                className="w-full bg-[#141418] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-zinc-300 font-medium flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-zinc-400" />
                <span>Target Cities (Optional)</span>
              </label>
              <input
                type="text"
                value={cities}
                onChange={(e) => setCities(e.target.value)}
                placeholder="e.g. Dallas, Houston, Austin"
                className="w-full bg-[#141418] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>

          {/* 3. Team Size (Employees) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1 border-t border-zinc-800/60">
            <div className="space-y-1.5">
              <label className="text-zinc-300 font-medium flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Min Team Size / Staff</span>
                </span>
                <span className="text-[10px] text-zinc-500">e.g. 5</span>
              </label>
              <input
                type="number"
                min="1"
                max="500"
                value={minEmployees ?? ""}
                onChange={(e) => setMinEmployees(e.target.value ? Number(e.target.value) : null)}
                placeholder="e.g. 5 (filter out 1-person solos)"
                className="w-full bg-[#141418] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-zinc-300 font-medium flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Max Team Size / Staff</span>
                </span>
                <span className="text-[10px] text-zinc-500">e.g. 50</span>
              </label>
              <input
                type="number"
                min="1"
                max="1000"
                value={maxEmployees ?? ""}
                onChange={(e) => setMaxEmployees(e.target.value ? Number(e.target.value) : null)}
                placeholder="e.g. 50 (leave empty for unlimited)"
                className="w-full bg-[#141418] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>

          {/* Real Estate Specific: Min Doors / Units Managed */}
          <div className="space-y-1.5 pt-1 border-t border-zinc-800/60">
            <label className="text-zinc-300 font-medium flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="text-sm">🏢</span>
                <span>Min Doors / Units Managed (Property Management)</span>
              </span>
              <span className="text-[10px] text-zinc-500">e.g. 50</span>
            </label>
            <input
              type="number"
              min="10"
              max="5000"
              value={minDoors ?? ""}
              onChange={(e) => setMinDoors(e.target.value ? Number(e.target.value) : null)}
              placeholder="e.g. 50 (targets mid-to-large PM firms with AppFolio/Buildium scale)"
              className="w-full bg-[#141418] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          {/* 4. Min ICP Score Slider */}
          <div className="space-y-2 pt-1 border-t border-zinc-800/60">
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 font-medium">Minimum ICP Fit Score</span>
              <span className="text-sm font-bold text-white px-2.5 py-0.5 rounded-lg bg-zinc-900 border border-zinc-800">
                {minScore} / 100
              </span>
            </div>
            <input
              type="range"
              min="40"
              max="90"
              step="5"
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-full accent-emerald-400"
            />
            <div className="flex justify-between text-[10px] text-zinc-500">
              <span>40 (Broad Intake)</span>
              <span>60 (Balanced Quality)</span>
              <span>80 (Strict Tier-1)</span>
            </div>
          </div>

          {/* 5. Must-Have Quality Gate Checkboxes */}
          <div className="space-y-2.5 pt-2 border-t border-zinc-800/60">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Must-Have Quality Gate (Strict CRM Entry Requirements)
            </div>
            <div className="grid grid-cols-1 gap-2">
              {GATE_FIELDS.map((field) => {
                const meta = GATE_META[field];
                const checked = Boolean(gate[field]);
                return (
                  <button
                    key={field}
                    type="button"
                    onClick={() => toggleGateField(field)}
                    className={`flex items-center justify-between p-3 rounded-xl border text-left transition ${
                      checked
                        ? "bg-emerald-950/20 border-emerald-500/40 text-white"
                        : "bg-[#141418] border-zinc-800/80 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-xs flex items-center gap-2">
                        <span>{meta.label}</span>
                        {checked && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                            REQUIRED
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{meta.description}</div>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ml-3 transition ${
                        checked
                          ? "bg-emerald-500 border-emerald-400 text-black"
                          : "border-zinc-700 bg-zinc-900"
                      }`}
                    >
                      {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 p-4 border-t border-zinc-800 bg-zinc-950/80">
          <button
            type="button"
            disabled={isPending}
            onClick={() => setIsOpen(false)}
            className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleSave}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition shadow-sm disabled:opacity-50"
          >
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            <span>{isPending ? "Saving Rules..." : "Save Targeting & Gate"}</span>
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // Compact Trigger Button for /caller workspace header
  if (compactTriggerOnly) {
    if (!canEditRules) return null;
    return (
      <>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-200 hover:text-white transition shadow-sm"
          title="Edit ICP Fit, Team Size, and Quality Gate rules"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
          <span>Edit ICP &amp; Gate</span>
        </button>
        {modalElement}
      </>
    );
  }

  // Full Card View for Main Dashboard (/)
  return (
    <>
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-5 space-y-4">
        {/* Card Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Active Quality Gate</h3>
          </div>
          {canEditRules && (
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white font-medium transition px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800"
            >
              <SlidersHorizontal className="w-3 h-3 text-zinc-400" />
              <span>Edit Rules &amp; ICP</span>
            </button>
          )}
        </div>

        {/* Card Details */}
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-[#09090b] p-2.5 border border-zinc-800">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium block">
                Min ICP Score
              </span>
              <span className="font-bold text-white text-sm">{minScore} / 100</span>
            </div>
            <div className="rounded-lg bg-[#09090b] p-2.5 border border-zinc-800">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium block">
                Target Team Size
              </span>
              <span className="font-bold text-zinc-200 text-sm">
                {minEmployees ? `${minEmployees}+` : "1+"}
                {maxEmployees ? ` to ${maxEmployees}` : "+"} Staff
              </span>
            </div>
          </div>

          {/* Quality Gate Badges */}
          <div className="rounded-lg bg-[#09090b] p-2.5 border border-zinc-800 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
              Must-Have Entry Requirements
            </div>
            <div className="flex flex-wrap gap-1.5">
              {GATE_FIELDS.map((field) => {
                const active = Boolean(gate[field]);
                const meta = GATE_META[field];
                return (
                  <span
                    key={field}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                      active
                        ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
                        : "bg-zinc-900/50 border-zinc-800 text-zinc-500 line-through opacity-60"
                    }`}
                  >
                    {active && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />}
                    <span>{meta.shortLabel}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Keywords */}
          <div className="space-y-1.5 pt-0.5 text-zinc-300">
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              Target Search Keywords
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(activeKeywords.length > 0 ? activeKeywords.slice(0, 5) : [marketName]).map(
                (kw, i) => (
                  <span
                    key={i}
                    className="rounded-md border border-zinc-800 bg-[#09090b] px-2 py-1 text-[11px] text-zinc-300"
                  >
                    {kw}
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {modalElement}
    </>
  );
}
