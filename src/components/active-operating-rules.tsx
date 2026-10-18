"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { updateRuleAction } from "@/app/rules/actions";
import type { RuleConfig } from "@/server/domain/rules";
import { SERVICE_KEYS, type ServiceKey } from "@/server/domain/rules";
import {
  SlidersHorizontal,
  Check,
  AlertCircle,
  X,
  RefreshCw,
  ArrowRight,
} from "lucide-react";

interface ActiveOperatingRulesProps {
  initialRule: {
    id: string;
    name: string;
    version: number;
    isDefault: boolean;
    config: RuleConfig;
  };
  nicheName?: string;
  canEditRules?: boolean;
}

export function ActiveOperatingRules({
  initialRule,
  nicheName,
  canEditRules = true,
}: ActiveOperatingRulesProps) {
  const [rule, setRule] = useState(initialRule);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [draftName, setDraftName] = useState(initialRule.name);
  const [draftConfig, setDraftConfig] = useState<RuleConfig>(initialRule.config);
  const [reEvaluateOnSave, setReEvaluateOnSave] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  React.useEffect(() => {
    setRule(initialRule);
    setDraftName(initialRule.name);
    setDraftConfig(initialRule.config);
  }, [initialRule]);

  const openEditor = () => {
    if (!canEditRules) return;
    setDraftName(rule.name);
    setDraftConfig(JSON.parse(JSON.stringify(rule.config)));
    setStatusMessage(null);
    setIsModalOpen(true);
  };

  const handleSave = () => {
    startTransition(async () => {
      setStatusMessage(null);
      const res = await updateRuleAction(rule.id, draftName, draftConfig, reEvaluateOnSave);

      if (res.ok) {
        setRule({
          ...rule,
          name: draftName,
          version: res.version ?? rule.version + 1,
          config: draftConfig,
        });

        const reScoreInfo = res.reScored
          ? ` (${res.reScored.reScoredCount} leads updated)`
          : "";

        setStatusMessage({
          type: "success",
          text: `Scoring rules saved${reScoreInfo}.`,
        });

        setTimeout(() => {
          setIsModalOpen(false);
          setStatusMessage(null);
        }, 1200);
      } else {
        setStatusMessage({
          type: "error",
          text: res.error || "Could not update rules.",
        });
      }
    });
  };

  const toggleRequiredService = (service: ServiceKey) => {
    const current = draftConfig.services.requiredAnyOf || [];
    const updated = current.includes(service)
      ? current.filter((s) => s !== service)
      : [...current, service];
    setDraftConfig({
      ...draftConfig,
      services: {
        ...draftConfig.services,
        requiredAnyOf: updated,
      },
    });
  };

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-5 space-y-4 lg:col-span-1">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Scoring Rules</h2>
          <p className="text-xs text-slate-400">
            How leads are filtered for {nicheName || "this niche"}
          </p>
        </div>
        {canEditRules && (
          <button
            type="button"
            onClick={openEditor}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/70 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            <span>Edit Rules</span>
          </button>
        )}
      </div>

      {/* Key Settings Grid */}
      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
          <div className="text-[11px] text-slate-400">Minimum Score</div>
          <div className="mt-1 text-base font-semibold text-white">
            {rule.config.scoring?.minScore ?? 70} / 100
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
          <div className="text-[11px] text-slate-400">Business Type</div>
          <div className="mt-1 text-sm font-semibold capitalize text-white truncate">
            {rule.config.businessType || "Both"}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
          <div className="text-[11px] text-slate-400">Target Services</div>
          <div
            className="mt-1 text-xs font-medium capitalize text-slate-200 truncate"
            title={rule.config.services?.requiredAnyOf?.join(", ") || "All services"}
          >
            {rule.config.services?.requiredAnyOf?.length
              ? rule.config.services.requiredAnyOf.join(", ").replace(/_/g, " ")
              : "All services"}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
          <div className="text-[11px] text-slate-400">Team Size</div>
          <div className="mt-1 text-sm font-semibold text-white">
            {rule.config.size?.minEmployees ?? 5}–{rule.config.size?.maxEmployees ?? 50} staff
          </div>
        </div>
      </div>

      {/* Simple Summary List */}
      <div className="space-y-2 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
        <div className="flex items-center justify-between">
          <span>Owner / Manager Required</span>
          <span className="font-medium text-slate-200">
            {rule.config.contacts?.ownerRequired ? "Yes" : "Optional"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Direct Phone Required</span>
          <span className="font-medium text-slate-200">
            {rule.config.contacts?.directPhoneRequired ? "Yes" : "Optional"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Business Email Required</span>
          <span className="font-medium text-slate-200">
            {rule.config.contacts?.businessEmailRequired ? "Yes" : "Optional"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Manual Review Before Export</span>
          <span className="font-medium text-emerald-400">Enabled</span>
        </div>
      </div>

      {canEditRules && (
        <div className="pt-1">
          <Link
            href="/rules"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:text-white"
          >
            <span>Open Full Rules Page</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Modal: Edit Rules */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-white">Edit Scoring Rules</h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Adjust how leads are scored and filtered for {nicheName || "this niche"}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-6">
              {statusMessage && (
                <div
                  className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${
                    statusMessage.type === "success"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  }`}
                >
                  {statusMessage.type === "success" ? (
                    <Check className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{statusMessage.text}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300">Rule Name</label>
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                />
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-medium text-white">
                      Minimum Score to Qualify
                    </label>
                    <p className="text-[11px] text-slate-400">
                      Leads below this score are marked as low fit.
                    </p>
                  </div>
                  <span className="text-base font-semibold text-white">
                    {draftConfig.scoring?.minScore ?? 70} / 100
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={draftConfig.scoring?.minScore ?? 70}
                  onChange={(e) =>
                    setDraftConfig({
                      ...draftConfig,
                      scoring: {
                        ...draftConfig.scoring,
                        minScore: parseInt(e.target.value, 10),
                      },
                    })
                  }
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Business Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: "residential", label: "Residential" },
                    { key: "both", label: "Both" },
                    { key: "commercial", label: "Commercial" },
                  ].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() =>
                        setDraftConfig({
                          ...draftConfig,
                          businessType: t.key as any,
                        })
                      }
                      className={`rounded-lg border p-2 text-xs font-medium transition ${
                        draftConfig.businessType === t.key
                          ? "border-slate-600 bg-slate-800 text-white"
                          : "border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Target Services
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SERVICE_KEYS.map((srv) => {
                    const isSelected = (draftConfig.services?.requiredAnyOf || []).includes(srv);
                    return (
                      <button
                        key={srv}
                        type="button"
                        onClick={() => toggleRequiredService(srv)}
                        className={`flex items-center justify-between rounded-lg border p-2 text-left text-xs capitalize transition ${
                          isSelected
                            ? "border-slate-600 bg-slate-800 text-white font-medium"
                            : "border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                        }`}
                      >
                        <span>{srv.replace(/_/g, " ")}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-sky-400" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300">Min Staff Size</label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={draftConfig.size?.minEmployees ?? 5}
                    onChange={(e) =>
                      setDraftConfig({
                        ...draftConfig,
                        size: {
                          ...draftConfig.size,
                          minEmployees: parseInt(e.target.value, 10) || null,
                        },
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300">Max Staff Size</label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={draftConfig.size?.maxEmployees ?? 50}
                    onChange={(e) =>
                      setDraftConfig({
                        ...draftConfig,
                        size: {
                          ...draftConfig.size,
                          maxEmployees: parseInt(e.target.value, 10) || null,
                        },
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                  />
                </div>
              </div>

              <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 p-3 cursor-pointer">
                <div>
                  <div className="text-xs font-medium text-white">Re-score existing leads now</div>
                  <div className="text-[11px] text-slate-400">
                    Update scores for all leads in this niche when saving.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={reEvaluateOnSave}
                  onChange={(e) => setReEvaluateOnSave(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-6 py-4">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
              >
                {isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isPending ? "Saving..." : "Save Rules"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
