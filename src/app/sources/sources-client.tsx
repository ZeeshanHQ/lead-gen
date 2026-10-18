"use client";

import React, { useState, useTransition } from "react";
import {
  Radio,
  CheckCircle2,
  AlertTriangle,
  Settings,
  ShieldCheck,
  FileSpreadsheet,
  Globe,
  Building2,
  Landmark,
  KeyRound,
  ExternalLink,
  Search,
} from "lucide-react";
import { toggleSourceAction, configureSourceAction } from "./actions";

interface SourceView {
  id: string;
  name: string;
  category: string;
  description: string;
  requiresApiKey: boolean;
  enabled: boolean;
  configured: boolean;
  costPerRequestUsd: number;
  attributionNotice?: string;
  retentionPolicyDays?: number;
  requests: number;
  errors: number;
  lastError: string | null;
}

export function SourcesClient({ sources }: { sources: SourceView[] }) {
  const [isPending, startTransition] = useTransition();
  const [editingSource, setEditingSource] = useState<SourceView | null>(null);

  const handleToggle = (sourceId: string, currentEnabled: boolean) => {
    startTransition(async () => {
      await toggleSourceAction(sourceId, !currentEnabled);
    });
  };

  const handleSaveConfig = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingSource) return;
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await configureSourceAction(editingSource.id, fd);
      setEditingSource(null);
    });
  };

  const getIcon = (category: string) => {
    switch (category) {
      case "user_upload":
        return <FileSpreadsheet className="w-4 h-4 text-cyan-400" />;
      case "directory":
        return <Building2 className="w-4 h-4 text-emerald-400" />;
      case "government":
        return <Landmark className="w-4 h-4 text-indigo-400" />;
      case "places":
        return <Globe className="w-4 h-4 text-amber-400" />;
      case "enrichment":
        return <KeyRound className="w-4 h-4 text-purple-400" />;
      case "search":
        return <Search className="w-4 h-4 text-cyan-400" />;
      default:
        return <Radio className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Active Discovery Sources
          </div>
          <div className="text-2xl font-bold text-white">
            {sources.filter((s) => s.enabled).length} / {sources.length}
          </div>
          <div className="text-xs text-slate-500">
            Pluggable, independently toggleable adapters
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Google Maps Compliance
          </div>
          <div className="text-sm font-semibold text-emerald-400 flex items-center gap-1.5 pt-1">
            <ShieldCheck className="w-4 h-4" />
            Zero Scraping • Field-Masked API
          </div>
          <div className="text-xs text-slate-500">
            Strict 30-day retention policies enforced
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Zero-Cost Intake
          </div>
          <div className="text-2xl font-bold text-cyan-400">
            {sources.filter((s) => s.costPerRequestUsd === 0).length} Sources
          </div>
          <div className="text-xs text-slate-500">
            Open trade directories &amp; direct intake available
          </div>
        </div>
      </div>

      {/* Sources Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sources.map((s) => (
          <div
            key={s.id}
            className={`p-5 rounded-xl border transition-all ${
              s.enabled
                ? "border-slate-700 bg-slate-900/80 shadow-lg shadow-black/20"
                : "border-slate-800/60 bg-slate-950/40 opacity-70"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/60">
                  {getIcon(s.category)}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    {s.name}
                    {s.requiresApiKey && !s.configured && (
                      <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-800">
                        Key Required
                      </span>
                    )}
                  </h3>
                  <div className="text-[11px] text-slate-400 capitalize">
                    Category: {s.category.replace("_", " ")} • Cost:{" "}
                    {s.costPerRequestUsd === 0
                      ? "Free"
                      : `$${s.costPerRequestUsd.toFixed(3)}/req`}
                  </div>
                </div>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => handleToggle(s.id, s.enabled)}
                disabled={isPending || (s.requiresApiKey && !s.configured && !s.enabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  s.enabled ? "bg-cyan-500" : "bg-slate-800"
                } ${s.requiresApiKey && !s.configured ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-slate-950 shadow ring-0 transition duration-200 ease-in-out ${
                    s.enabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <p className="text-xs text-slate-400 mt-3 leading-relaxed">
              {s.description}
            </p>

            {s.attributionNotice && (
              <div className="mt-3 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[10px] text-slate-400 flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                <span>{s.attributionNotice}</span>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-3 text-slate-400">
                <span>Requests: <strong className="text-white">{s.requests}</strong></span>
                {s.errors > 0 && (
                  <span className="text-rose-400">Errors: {s.errors}</span>
                )}
              </div>

              {s.requiresApiKey && (
                <button
                  onClick={() => setEditingSource(s)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition-colors"
                >
                  <Settings className="w-3 h-3 text-cyan-400" />
                  Configure
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Configuration Modal */}
      {editingSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-cyan-400" />
                Configure {editingSource.name}
              </h3>
              <button
                onClick={() => setEditingSource(null)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  API Key / Secret Token
                </label>
                <input
                  type="password"
                  name="apiKey"
                  placeholder="Enter API key"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Keys are stored encrypted with AES-256 and never logged.
                </span>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Max Requests per Run
                </label>
                <input
                  type="number"
                  name="maxRequests"
                  defaultValue={25}
                  min={1}
                  max={100}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingSource(null)}
                  className="px-3 py-1.5 rounded-md text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold text-xs shadow"
                >
                  {isPending ? "Saving..." : "Save Configuration"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
