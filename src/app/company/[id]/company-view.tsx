"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ProvenanceBadge,
  ContactQualityBadge,
  ContactGradeBadge,
  LifecycleBadge,
} from "@/components/badges";
import {
  acceptSuggestionAction,
  rejectSuggestionAction,
  clearFactAction,
  addHumanFactAction,
} from "@/app/review/actions";
import { formatDate, formatDateTime } from "@/lib/utils";
import { FACT_LABELS, type FactKey } from "@/server/domain/facts";
import {
  Building,
  Globe,
  Phone,
  MapPin,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  History,
  User,
  Plus,
  Clock,
  Sparkles,
  Layers,
} from "lucide-react";

interface CompanyViewProps {
  detail: any;
}

export function CompanyView({ detail }: CompanyViewProps) {
  const router = useRouter();
  const { company, contacts, best, evidence, approvals, refs, score, suggestions, history } = detail;

  const [activeTab, setActiveTab] = useState<"facts" | "contacts" | "evidence" | "history">("facts");

  // New Fact Form state
  const [showAddFact, setShowAddFact] = useState(false);
  const [newFactKey, setNewFactKey] = useState<FactKey>("replacement");
  const [newFactVal, setNewFactVal] = useState("YES");
  const [newFactEvidence, setNewFactEvidence] = useState("");
  const [newFactSourceUrl, setNewFactSourceUrl] = useState("");
  const [factSaving, setFactSaving] = useState(false);

  const handleAddFact = async (e: React.FormEvent) => {
    e.preventDefault();
    setFactSaving(true);
    await addHumanFactAction(
      company.id,
      newFactKey,
      newFactVal,
      newFactEvidence,
      newFactSourceUrl
    );
    setFactSaving(false);
    setShowAddFact(false);
    setNewFactEvidence("");
    router.refresh();
  };

  const handleClearFact = async (k: FactKey) => {
    if (!confirm(`Are you sure you want to reset "${FACT_LABELS[k]}" to UNKNOWN?`)) return;
    await clearFactAction(company.id, k);
    router.refresh();
  };

  const handleAcceptSuggestion = async (id: string) => {
    await acceptSuggestionAction(id);
    router.refresh();
  };

  const handleRejectSuggestion = async (id: string) => {
    await rejectSuggestionAction(id);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Title */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Link href="/review" className="hover:text-cyan-400">
              Review Queue
            </Link>
            <span>/</span>
            <span className="text-slate-200">{company.name}</span>
          </div>

          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white tracking-tight">{company.name}</h1>
            <LifecycleBadge status={company.status} />
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {score && (
            <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
              <div>
                <span className="text-slate-400 text-[10px] block">ICP SCORE</span>
                <span className="text-base font-extrabold text-cyan-300">{score.icpScore}/100</span>
              </div>
              <div className="border-l border-slate-800 pl-3">
                <span className="text-slate-400 text-[10px] block">CONFIDENCE</span>
                <span className="text-base font-extrabold text-indigo-300">
                  {score.researchConfidence}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* "AI found a possible update" suggestions banner */}
      {suggestions.length > 0 && (
        <div className="p-4 rounded-xl border border-indigo-700/80 bg-indigo-950/40 space-y-3">
          <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span>AI Found a Possible Update on Human-Locked Fields ({suggestions.length})</span>
          </div>
          <p className="text-xs text-indigo-200">
            Because a human confirmed the current values, automated research will never silently overwrite them. You may review and accept or reject the suggestions below:
          </p>

          <div className="space-y-2">
            {suggestions.map((s: any) => (
              <div
                key={s.id}
                className="p-3 rounded-lg bg-slate-950 border border-indigo-900/60 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="text-slate-400 uppercase font-mono text-[10px]">
                    {FACT_LABELS[s.field as FactKey] ?? s.field}:
                  </span>{" "}
                  <span className="line-through text-slate-500 mr-2">{s.currentValue ?? "None"}</span>
                  <span className="font-bold text-cyan-300">&rarr; {s.suggestedValue}</span>{" "}
                  <span className="text-slate-400 text-[11px]">
                    ({(s.suggestedConfidence * 100).toFixed(0)}% conf)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAcceptSuggestion(s.id)}
                    className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-600/60 font-semibold text-xs"
                  >
                    Accept Update
                  </button>
                  <button
                    onClick={() => handleRejectSuggestion(s.id)}
                    className="px-2.5 py-1 rounded bg-rose-950/40 hover:bg-rose-950/80 text-rose-300 border border-rose-900/60 font-semibold text-xs"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Profile Header Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Core Identity */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3 text-xs lg:col-span-1">
          <h3 className="font-bold text-white text-sm border-b border-slate-800 pb-2 flex items-center gap-2">
            <Building className="w-4 h-4 text-cyan-400" />
            Company Identity
          </h3>

          <div className="space-y-2.5">
            <div>
              <span className="text-slate-400 block text-[11px]">Website</span>
              {company.website ? (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline inline-flex items-center gap-1 font-medium"
                >
                  <span>{company.domain}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-slate-500">Not recorded</span>
              )}
            </div>

            <div>
              <span className="text-slate-400 block text-[11px]">Company Main Phone</span>
              <p className="font-mono text-slate-200">{company.phoneDisplay ?? "NOT FOUND"}</p>
            </div>

            <div>
              <span className="text-slate-400 block text-[11px]">Location</span>
              <p className="text-slate-200">
                {company.address ? `${company.address}, ` : ""}
                {company.city ?? "No City"}, {company.state ?? "No State"}{" "}
                {company.zip ? company.zip : ""}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div>
                Discovered via: <span className="text-slate-200 font-medium">{company.discoveredVia}</span>
              </div>
              <div>
                Last Verified:{" "}
                <span className="text-slate-200 font-medium">{formatDate(company.lastVerifiedAt)}</span>
              </div>
              {company.lockedFields?.length > 0 && (
                <div className="text-amber-400">
                  Locked fields: {company.lockedFields.join(", ")}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Best Available Contact Card */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3 text-xs lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              <User className="w-4 h-4 text-cyan-400" />
              Best Available Business Contact
            </h3>
            <div className="flex items-center gap-2">
              <ContactGradeBadge grade={best.grade} />
              <ContactQualityBadge label={best.label} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1">
              <span className="text-slate-400 block text-[11px]">Contact Person</span>
              <p className="font-bold text-white text-sm">{best.name ?? "None Identified"}</p>
              <span className="text-slate-300">{best.title ?? "Direct phone: NOT FOUND"}</span>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 block text-[11px]">Primary Number / Channel</span>
              <p className="text-cyan-300 font-bold text-sm flex items-center gap-1.5 font-mono">
                <Phone className="w-3.5 h-3.5 text-cyan-400" />
                {best.phone ?? company.phoneDisplay ?? "NOT FOUND"}
              </p>
              {best.email && (
                <span className="text-slate-400 text-[11px] block">{best.email}</span>
              )}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] text-slate-300 space-y-1">
            <span className="font-semibold text-slate-200">Contact Selection Rationale:</span>
            <p className="text-slate-400">{best.reason}</p>
          </div>
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="flex border-b border-slate-800 text-xs">
        <button
          onClick={() => setActiveTab("facts")}
          className={`px-4 py-2.5 font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "facts"
              ? "border-cyan-500 text-cyan-400 bg-slate-900/40"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Audited Facts &amp; Signals
        </button>
        <button
          onClick={() => setActiveTab("contacts")}
          className={`px-4 py-2.5 font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "contacts"
              ? "border-cyan-500 text-cyan-400 bg-slate-900/40"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <User className="w-3.5 h-3.5" />
          Contacts ({contacts.length})
        </button>
        <button
          onClick={() => setActiveTab("evidence")}
          className={`px-4 py-2.5 font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "evidence"
              ? "border-cyan-500 text-cyan-400 bg-slate-900/40"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Raw Evidence Rows ({evidence.length})
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`px-4 py-2.5 font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "history"
              ? "border-cyan-500 text-cyan-400 bg-slate-900/40"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <History className="w-3.5 h-3.5" />
          Audit History ({history.length})
        </button>
      </div>

      {/* Tab: Facts */}
      {activeTab === "facts" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Each fact requires attributable evidence text and source URL. Absence of proof is UNKNOWN.
            </span>
            <button
              onClick={() => setShowAddFact(!showAddFact)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              Add / Override Fact
            </button>
          </div>

          {/* Add fact inline form */}
          {showAddFact && (
            <form
              onSubmit={handleAddFact}
              className="p-4 rounded-xl border border-slate-700 bg-slate-900 space-y-3 text-xs"
            >
              <h4 className="font-bold text-white">Add Human Confirmed Fact</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Field</label>
                  <select
                    value={newFactKey}
                    onChange={(e) => setNewFactKey(e.target.value as FactKey)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200"
                  >
                    {Object.entries(FACT_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Value</label>
                  <input
                    type="text"
                    required
                    value={newFactVal}
                    onChange={(e) => setNewFactVal(e.target.value)}
                    placeholder="YES, NO, or e.g. 5-20"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Source URL (Optional)</label>
                  <input
                    type="text"
                    value={newFactSourceUrl}
                    onChange={(e) => setNewFactSourceUrl(e.target.value)}
                    placeholder="https://example.com/team"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Evidence Snippet / Rationale</label>
                <input
                  type="text"
                  required
                  value={newFactEvidence}
                  onChange={(e) => setNewFactEvidence(e.target.value)}
                  placeholder="e.g. Phone conversation with receptionist confirmed 12 field service techs."
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddFact(false)}
                  className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={factSaving || !newFactEvidence.trim()}
                  className="px-4 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
                >
                  {factSaving ? "Saving..." : "Save Fact"}
                </button>
              </div>
            </form>
          )}

          {/* Grid of Facts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(company.facts ?? {}).map(([key, entry]: [string, any]) => (
              <div
                key={key}
                className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">
                    {FACT_LABELS[key as FactKey] ?? key}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-bold px-2 py-0.5 rounded text-xs ${
                        entry.value === "YES"
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          : entry.value === "NO"
                          ? "bg-zinc-900 text-zinc-400 border border-zinc-800"
                          : "bg-slate-900 text-slate-300 border border-slate-800"
                      }`}
                    >
                      {entry.value}
                    </span>
                    <button
                      onClick={() => handleClearFact(key as FactKey)}
                      className="text-slate-500 hover:text-rose-400 text-[10px]"
                      title="Reset to UNKNOWN"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <ProvenanceBadge provenance={entry.provenance} />
                  <span>Conf: {(entry.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Contacts */}
      {activeTab === "contacts" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
            <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800">
              <thead className="bg-slate-950 text-[11px] font-semibold uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Name &amp; Role</th>
                  <th className="px-3 py-3">Title</th>
                  <th className="px-3 py-3">Phone &amp; Quality</th>
                  <th className="px-3 py-3">Email</th>
                  <th className="px-3 py-3">Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {contacts.map((c: any) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-semibold text-white">
                      {c.name ?? "Unknown Name"}
                      <span className="block text-[11px] text-slate-400 font-normal capitalize">
                        {c.roleClass.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-300">{c.title ?? "--"}</td>
                    <td className="px-3 py-3">
                      <div className="space-y-0.5">
                        <span className="font-mono text-cyan-300">{c.phoneDisplay ?? "None"}</span>
                        <ContactQualityBadge label={c.phoneType} className="block w-max text-[10px]" />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-300">{c.email ?? "--"}</td>
                    <td className="px-3 py-3">
                      <ProvenanceBadge provenance={c.provenance} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Raw Evidence */}
      {activeTab === "evidence" && (
        <div className="space-y-3">
          {evidence.map((ev: any) => (
            <div
              key={ev.id}
              className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-cyan-400 font-semibold uppercase text-[11px]">
                  {ev.field}: <span className="text-white">{ev.value}</span>
                </span>
                <ProvenanceBadge provenance={ev.provenance} />
              </div>

              <blockquote className="text-slate-300 italic border-l-2 border-cyan-500 pl-2 bg-slate-950/60 p-2 rounded">
                &ldquo;{ev.evidenceText}&rdquo;
              </blockquote>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Source: {ev.sourceType}</span>
                {ev.sourceUrl && (
                  <a
                    href={ev.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:underline inline-flex items-center gap-1"
                  >
                    <span>{ev.sourceUrl}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: History */}
      {activeTab === "history" && (
        <div className="space-y-2 text-xs">
          {history.map((h: any) => (
            <div
              key={h.id}
              className="p-3 rounded-lg border border-slate-800 bg-slate-900/40 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                  {h.action}
                </span>
                <span className="text-slate-300">
                  Actor: <strong className="text-white">{h.actor}</strong>
                </span>
              </div>
              <span className="text-[11px] text-slate-500">{formatDateTime(h.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
