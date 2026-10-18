"use client";

import React, { useState } from "react";
import { updateRuleAction, reEvaluateLeadsAction } from "./actions";
import type { RuleConfig } from "@/server/domain/rules";
import {
  SERVICE_KEYS,
  SIGNAL_KEYS,
  SCORE_CATEGORIES,
  SCORE_CATEGORY_LABEL,
  SCORE_SIGNALS,
  SCORE_SIGNAL_LABEL,
} from "@/server/domain/rules";
import { SOFTWARE_KEYS, SOFTWARE_LABELS } from "@/server/domain/facts";
import { COMPLETENESS_FIELDS, COMPLETENESS_LABEL } from "@/server/domain/completeness";
import { Check, AlertCircle, Save, Info, RefreshCw, Sparkles, Search, X, Plus } from "lucide-react";

interface RuleEditorProps {
  rule: {
    id: string;
    name: string;
    version: number;
    isDefault: boolean;
    config: RuleConfig;
  };
}

export function RuleEditor({ rule }: RuleEditorProps) {
  const [currentRule, setCurrentRule] = useState(rule);
  const [name, setName] = useState(rule.name);
  const [config, setConfig] = useState<RuleConfig>(rule.config);
  const [saving, setSaving] = useState(false);
  const [reEvaluating, setReEvaluating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [newKeyword, setNewKeyword] = useState("");

  const handleAddKeyword = () => {
    const clean = newKeyword.trim();
    if (!clean) return;
    const currentKws = config.discovery?.keywords || [];
    if (!currentKws.includes(clean)) {
      setConfig({
        ...config,
        discovery: {
          ...config.discovery,
          keywords: [...currentKws, clean],
        },
      });
    }
    setNewKeyword("");
  };

  const handleRemoveKeyword = (kwToRemove: string) => {
    const currentKws = config.discovery?.keywords || [];
    setConfig({
      ...config,
      discovery: {
        ...config.discovery,
        keywords: currentKws.filter((k) => k !== kwToRemove),
      },
    });
  };

  // Quick category cap sum check
  const capSum = Object.values(config.scoring.categoryCaps).reduce((a, b) => a + Number(b), 0);

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg(null);
    const res = await updateRuleAction(currentRule.id, name, config, true);
    setSaving(false);
    if (res.ok) {
      setCurrentRule((prev) => ({
        ...prev,
        version: res.version ?? prev.version + 1,
        name,
        config,
      }));
      const info = res.reScored
        ? ` (${res.reScored.reScoredCount} candidate leads re-scored in real-time: ${res.reScored.qualifiedCount} qualified, ${res.reScored.disqualifiedCount} disqualified)`
        : "";
      setStatusMsg({
        type: "success",
        text: `Research rule v${res.version ?? currentRule.version + 1} successfully saved and active in backend!${info}`,
      });
    } else {
      setStatusMsg({ type: "error", text: res.error || "Failed to save rule" });
    }
  };

  const handleReEvaluateOnly = async () => {
    setReEvaluating(true);
    setStatusMsg(null);
    const res = await reEvaluateLeadsAction(currentRule.id);
    setReEvaluating(false);
    if (res.ok) {
      setStatusMsg({
        type: "success",
        text: `Live Re-Evaluation Complete: ${res.reScoredCount} candidate leads re-processed (${res.qualifiedCount} qualified, ${res.disqualifiedCount} disqualified).`,
      });
    } else {
      setStatusMsg({ type: "error", text: res.error || "Failed to re-evaluate leads" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/80">
        <div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-lg font-bold text-white bg-slate-950 px-3 py-1 rounded border border-slate-700 focus:outline-none focus:border-cyan-500"
            />
            {currentRule.isDefault && (
              <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                ACTIVE DEFAULT RULE
              </span>
            )}
            <span className="text-xs text-slate-400 font-mono">v{currentRule.version}</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Deterministic rules govern qualification, scoring &amp; crawler constraints. Changes process immediately in backend.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleReEvaluateOnly}
            disabled={reEvaluating || saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-semibold text-xs border border-slate-700 transition-all"
            title="Re-evaluate all candidate leads in database against current rules"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${reEvaluating ? "animate-spin" : ""}`} />
            <span>{reEvaluating ? "Re-Scoring..." : "Re-Score All Leads"}</span>
          </button>

          <button
            onClick={handleSave}
            disabled={saving || capSum !== 100}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-md transition-all"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving & Re-Scoring..." : "Save & Apply Live Rules"}
          </button>
        </div>
      </div>

      {statusMsg && (
        <div
          className={`p-3 rounded-lg text-xs flex items-center gap-2 border ${
            statusMsg.type === "success"
              ? "bg-emerald-950/80 text-emerald-300 border-emerald-800"
              : "bg-rose-950/80 text-rose-300 border-rose-800"
          }`}
        >
          {statusMsg.type === "success" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {statusMsg.text}
        </div>
      )}

      {/* Grid of Rule Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1. Geography */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center justify-between border-b border-slate-800 pb-2">
            <span>1. Target Geography</span>
            <span className="text-xs text-slate-400 font-normal">United States scope</span>
          </h3>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-400 block mb-1">Country</label>
              <input
                type="text"
                value={config.geography.country}
                onChange={(e) =>
                  setConfig({ ...config, geography: { ...config.geography, country: e.target.value } })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Target States (comma-separated, leave blank for all US states)</label>
              <input
                type="text"
                value={config.geography.states.join(", ")}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    geography: {
                      ...config.geography,
                      states: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    },
                  })
                }
                placeholder="e.g. TX, FL, GA, NC, AZ"
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Target Cities (comma-separated, optional)</label>
              <input
                type="text"
                value={config.geography.cities.join(", ")}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    geography: {
                      ...config.geography,
                      cities: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    },
                  })
                }
                placeholder="e.g. Dallas, Fort Worth, Houston, Austin"
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200"
              />
            </div>
          </div>
        </div>

        {/* 2. Discovery Keywords & Niche Terms */}
        <div className="p-5 rounded-xl border border-cyan-500/30 bg-slate-900/60 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5">
              <Search className="w-4 h-4 text-cyan-400" />
              <span>2. Discovery Search Keywords &amp; Niche Terms</span>
            </span>
            <span className="text-xs text-cyan-400 font-semibold">Powers Real-Time AI Search</span>
          </h3>

          <div className="space-y-3 text-xs">
            <p className="text-slate-400 leading-relaxed text-[11px]">
              These dynamic keywords feed into the Tavily Real-Time Discovery engine to discover active contractor domains. You can target any custom niche, service, or brand certification.
            </p>

            {/* Keyword chips */}
            <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 rounded-lg bg-slate-950 border border-slate-800">
              {(config.discovery?.keywords || []).map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-cyan-950/80 text-cyan-300 border border-cyan-800 text-xs font-medium"
                >
                  <span>{kw}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveKeyword(kw)}
                    className="hover:text-rose-400 text-cyan-400 p-0.5 rounded transition-colors"
                    title={`Remove "${kw}"`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {(config.discovery?.keywords || []).length === 0 && (
                <span className="text-slate-500 italic text-[11px]">No custom keywords set (default terms will be used)</span>
              )}
            </div>

            {/* Add Keyword input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddKeyword();
                  }
                }}
                placeholder="e.g. heat pump installation, commercial refrigeration..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 text-xs"
              />
              <button
                type="button"
                onClick={handleAddKeyword}
                disabled={!newKeyword.trim()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-bold text-xs transition-colors shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>

            {/* Candidate & Concurrency Limits */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/60">
              <div>
                <label className="text-slate-400 block mb-1">Max Candidates Per Batch</label>
                <input
                  type="number"
                  min="5"
                  max="200"
                  value={config.discovery?.limits?.maxCandidates ?? 50}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      discovery: {
                        ...config.discovery,
                        limits: {
                          ...config.discovery.limits,
                          maxCandidates: Number(e.target.value),
                        },
                      },
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Max Pages Crawled / Site</label>
                <input
                  type="number"
                  min="3"
                  max="30"
                  value={config.discovery?.limits?.pagesPerCompany ?? 12}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      discovery: {
                        ...config.discovery,
                        limits: {
                          ...config.discovery.limits,
                          pagesPerCompany: Number(e.target.value),
                        },
                      },
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 3. Business Type & Services */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center justify-between border-b border-slate-800 pb-2">
            <span>3. Business Focus &amp; Services</span>
            <span className="text-xs text-slate-400 font-normal">ICP core signals</span>
          </h3>

          <div className="space-y-4 text-xs">
            <div>
              <label className="text-slate-400 block mb-1.5">Business Customer Focus</label>
              <div className="flex gap-4">
                {(["residential", "commercial", "both"] as const).map((bt) => (
                  <label key={bt} className="flex items-center gap-2 text-slate-300 capitalize cursor-pointer">
                    <input
                      type="radio"
                      name="businessType"
                      checked={config.businessType === bt}
                      onChange={() => setConfig({ ...config, businessType: bt })}
                      className="accent-cyan-500"
                    />
                    {bt}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-slate-400 block mb-1.5">
                Required Services (<span className="text-cyan-400 font-semibold">At least one must be verified</span>)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {SERVICE_KEYS.map((k) => {
                  const checked = config.services.requiredAnyOf.includes(k as any);
                  return (
                    <label key={k} className="flex items-center gap-2 text-slate-300 capitalize cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...config.services.requiredAnyOf, k as any]
                            : config.services.requiredAnyOf.filter((x) => x !== k);
                          setConfig({ ...config, services: { ...config.services, requiredAnyOf: next } });
                        }}
                        className="accent-cyan-500"
                      />
                      {k.replace(/_/g, " ")}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/60">
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.requirements.websiteRequired}
                  onChange={(e) =>
                    setConfig({ ...config, requirements: { websiteRequired: e.target.checked } })
                  }
                  className="accent-cyan-500"
                />
                Require company website (disqualifies leads with no verifiable web presence)
              </label>
            </div>
          </div>
        </div>

        {/* 4. Company Size */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center justify-between border-b border-slate-800 pb-2">
            <span>4. Company Size Filter</span>
            <span className="text-xs text-amber-400 font-normal">Sales Filter, Not Industry Definition</span>
          </h3>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 block mb-1">Min Employees</label>
                <input
                  type="number"
                  value={config.size.minEmployees ?? ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      size: { ...config.size, minEmployees: e.target.value ? Number(e.target.value) : null },
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Max Employees</label>
                <input
                  type="number"
                  value={config.size.maxEmployees ?? ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      size: { ...config.size, maxEmployees: e.target.value ? Number(e.target.value) : null },
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-slate-300 cursor-pointer mt-2">
              <input
                type="checkbox"
                checked={config.size.allowUnknown}
                onChange={(e) =>
                  setConfig({ ...config, size: { ...config.size, allowUnknown: e.target.checked } })
                }
                className="accent-cyan-500"
              />
              Allow UNKNOWN employee count (we never invent employee numbers; check this so unestimated leads aren't dropped)
            </label>
          </div>
        </div>

        {/* 5. Preferred Business Signals */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center justify-between border-b border-slate-800 pb-2">
            <span>5. Preferred Operational Signals</span>
            <span className="text-xs text-slate-400 font-normal">Complexity &amp; scale markers</span>
          </h3>

          <div className="grid grid-cols-2 gap-2 text-xs">
            {SIGNAL_KEYS.map((k) => {
              const checked = config.signals.preferred.includes(k as any);
              return (
                <label key={k} className="flex items-center gap-2 text-slate-300 capitalize cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...config.signals.preferred, k as any]
                        : config.signals.preferred.filter((x) => x !== k);
                      setConfig({ ...config, signals: { preferred: next } });
                    }}
                    className="accent-cyan-500"
                  />
                  {k.replace(/_/g, " ")}
                </label>
              );
            })}
          </div>
        </div>

        {/* 6. Contact Requirements */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center justify-between border-b border-slate-800 pb-2">
            <span>6. Contact Strictness</span>
            <span className="text-xs text-slate-400 font-normal">Gate approval</span>
          </h3>

          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.contacts.ownerRequired}
                onChange={(e) =>
                  setConfig({ ...config, contacts: { ...config.contacts, ownerRequired: e.target.checked } })
                }
                className="accent-cyan-500"
              />
              Owner / President name strictly required
            </label>
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.contacts.decisionMakerNameRequired}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    contacts: { ...config.contacts, decisionMakerNameRequired: e.target.checked },
                  })
                }
                className="accent-cyan-500"
              />
              Any decision-maker name required (Owner, GM, Operations, Sales)
            </label>
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.contacts.directPhoneRequired}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    contacts: { ...config.contacts, directPhoneRequired: e.target.checked },
                  })
                }
                className="accent-cyan-500"
              />
              Direct professional phone required (not just main company line)
            </label>
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.contacts.businessEmailRequired}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    contacts: { ...config.contacts, businessEmailRequired: e.target.checked },
                  })
                }
                className="accent-cyan-500"
              />
              Professional business email required
            </label>
          </div>
        </div>

        {/* 6b. Fully Qualified: required data */}
        <div className="p-5 rounded-xl border border-emerald-900/60 bg-slate-900/60 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center justify-between border-b border-slate-800 pb-2">
            <span>6b. Fully Qualified — Required Data</span>
            <span className="text-xs text-emerald-400 font-semibold">Completeness gate</span>
          </h3>
          <p className="text-xs text-slate-400">
            A lead appears under <strong>Qualified Leads</strong> only when every field ticked here is present. Leads missing any of
            them stay in &ldquo;Almost qualified&rdquo; with the exact gaps listed.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {COMPLETENESS_FIELDS.map((f) => {
              const fields = config.completeness.requiredFields;
              return (
                <label key={f} className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fields.includes(f)}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        completeness: {
                          ...config.completeness,
                          requiredFields: e.target.checked ? [...fields, f] : fields.filter((x) => x !== f),
                        },
                      })
                    }
                    className="accent-emerald-500"
                  />
                  {COMPLETENESS_LABEL[f]}
                </label>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer border-t border-slate-800 pt-3">
            <input
              type="checkbox"
              checked={config.completeness.requireVerifiedOwner}
              onChange={(e) =>
                setConfig({ ...config, completeness: { ...config.completeness, requireVerifiedOwner: e.target.checked } })
              }
              className="accent-emerald-500"
            />
            CEO / Owner must be verified against a source (not just a typed name)
          </label>
        </div>

        {/* 7. Technology Tracking */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center justify-between border-b border-slate-800 pb-2">
            <span>7. Technology / CRM Tracking</span>
            <span className="text-xs text-indigo-400 font-semibold">Signal Only</span>
          </h3>

          <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-900/40 text-xs text-indigo-200 flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              <strong>Crucial business rule:</strong> Existing software (ServiceTitan, Jobber, Housecall Pro) does <em>NOT</em> disqualify a company. It is recorded as a research signal to tailor outbound conversation context.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            {SOFTWARE_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.technology.track.includes(k as any)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...config.technology.track, k as any]
                      : config.technology.track.filter((x) => x !== k);
                    setConfig({ ...config, technology: { track: next } });
                  }}
                  className="accent-cyan-500"
                />
                {SOFTWARE_LABELS[k]}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 8. Scoring Engine Weights & Caps */}
      <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white">8. Transparent ICP Scoring Engine (0–100)</h3>
            <p className="text-xs text-slate-400">
              ICP Score represents account fit only (never guarantee of sale). Separate from research confidence.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Category Caps Total:</span>
            <span
              className={`font-bold px-2 py-0.5 rounded ${
                capSum === 100
                  ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                  : "bg-rose-950 text-rose-400 border border-rose-800"
              }`}
            >
              {capSum} / 100
            </span>
          </div>
        </div>

        {/* Category Caps */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {SCORE_CATEGORIES.map((cat) => (
            <div key={cat} className="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <span className="text-[11px] text-slate-400 block truncate" title={SCORE_CATEGORY_LABEL[cat]}>
                {SCORE_CATEGORY_LABEL[cat]}
              </span>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={config.scoring.categoryCaps[cat]}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setConfig({
                      ...config,
                      scoring: {
                        ...config.scoring,
                        categoryCaps: { ...config.scoring.categoryCaps, [cat]: val },
                      },
                    });
                  }}
                  className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-bold"
                />
                <span className="text-xs text-slate-400">pts max</span>
              </div>
            </div>
          ))}
        </div>

        {/* Minimum Score Threshold */}
        <div className="flex items-center gap-3 pt-2 text-xs">
          <span className="text-slate-300 font-medium">Recommended Minimum Score:</span>
          <input
            type="number"
            min="0"
            max="100"
            value={config.scoring.minScore}
            onChange={(e) =>
              setConfig({
                ...config,
                scoring: { ...config.scoring, minScore: Number(e.target.value) },
              })
            }
            className="w-20 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-slate-100 font-bold"
          />
          <span className="text-slate-400">(Leads below this are flagged for lower priority)</span>
        </div>
      </div>
    </div>
  );
}
