"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { addExclusionAction, removeExclusionAction } from "./actions";
import { type ExclusionRule, EXCLUSION_KINDS } from "@/server/domain/rules";
import { ShieldAlert, Trash2, Plus, AlertCircle, CheckCircle2 } from "lucide-react";

interface ExclusionManagerProps {
  initialExclusions: ExclusionRule[];
}

export function ExclusionManager({ initialExclusions }: ExclusionManagerProps) {
  const router = useRouter();
  const [kind, setKind] = useState<string>("domain");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Add Exclusion Form */}
      <form
        onSubmit={handleAdd}
        className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4 text-xs"
      >
        <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2 flex items-center gap-2">
          <Plus className="w-4 h-4 text-cyan-400" />
          Add Exclusion Rule
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
              placeholder="e.g. Commercial aggregator, out of territory"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={saving || !value.trim()}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs shadow-md transition-all"
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
            No exclusions configured. All valid US residential HVAC contractors can be evaluated.
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
                  className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
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
