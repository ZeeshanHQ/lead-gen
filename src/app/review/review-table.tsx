"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeadRow } from "@/server/repo/queue";
import {
  ContactQualityBadge,
  ContactGradeBadge,
  LifecycleBadge,
  FactBadge,
} from "@/components/badges";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { ApprovalModal } from "@/components/approval-modal";
import { EditCompanyModal } from "@/components/edit-company-modal";
import { rejectLeadAction, restoreLeadAction } from "./actions";
import { formatDate } from "@/lib/utils";
import { triFactDisplay } from "@/server/domain/facts";
import {
  Search,
  Filter,
  CheckCircle,
  XCircle,
  FileText,
  Edit,
  ExternalLink,
  Phone,
  Building,
  User,
  RotateCcw,
  Sparkles,
  MapPin,
} from "lucide-react";

interface ReviewTableProps {
  initialRows: LeadRow[];
  states: string[];
}

export function ReviewTable({ initialRows, states }: ReviewTableProps) {
  const router = useRouter();

  // Filters state
  const [q, setQ] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [minScore, setMinScore] = useState<number | "">("");
  const [replacement, setReplacement] = useState("");
  const [installation, setInstallation] = useState("");
  const [financing, setFinancing] = useState("");
  const [hasDm, setHasDm] = useState("");
  const [hasDirect, setHasDirect] = useState("");
  const [software, setSoftware] = useState("");

  // Modals & Drawers state
  const [evidenceCompanyId, setEvidenceCompanyId] = useState<string | null>(null);
  const [approvingCompanyId, setApprovingCompanyId] = useState<string | null>(null);
  const [editingLead, setEditingLead] = useState<LeadRow | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  // Client-side filtering for ultra-responsive feel
  const filtered = initialRows.filter((r) => {
    if (q) {
      const matchText = `${r.name} ${r.domain ?? ""} ${r.city ?? ""} ${r.state ?? ""}`.toLowerCase();
      if (!matchText.includes(q.toLowerCase())) return false;
    }
    if (stateFilter && r.state !== stateFilter) return false;
    if (minScore !== "" && (r.icpScore ?? 0) < Number(minScore)) return false;
    if (replacement && (r.facts.replacement?.value ?? "UNKNOWN") !== replacement) return false;
    if (installation && (r.facts.installation?.value ?? "UNKNOWN") !== installation) return false;
    if (financing && (r.facts.financing?.value ?? "UNKNOWN") !== financing) return false;
    if (hasDm === "yes" && !r.hasDecisionMaker) return false;
    if (hasDm === "no" && r.hasDecisionMaker) return false;
    if (hasDirect === "yes" && !r.hasDirectContact) return false;
    if (hasDirect === "no" && r.hasDirectContact) return false;
    if (software) {
      const currentSw = r.facts.software?.value ?? "";
      if (software === "none" && currentSw && currentSw !== "UNKNOWN") return false;
      if (software !== "none" && !currentSw.includes(software)) return false;
    }
    return true;
  });

  const handleQuickReject = async (id: string) => {
    const reason = window.prompt("Reason for rejection (e.g. out of service area, commercial only):");
    if (reason === null) return;
    setRejectingId(id);
    await rejectLeadAction(id, reason);
    setRejectingId(null);
    router.refresh();
  };

  const handleRestore = async (id: string) => {
    setRejectingId(id);
    await restoreLeadAction(id);
    setRejectingId(null);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Bar */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search box */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search companies, domains, cities..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* State Filter */}
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="">All States ({states.length})</option>
            {states.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          {/* Min ICP Score */}
          <select
            value={minScore}
            onChange={(e) => setMinScore(e.target.value ? Number(e.target.value) : "")}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="">Min Score: Any</option>
            <option value="70">&ge; 70 (Call Ready)</option>
            <option value="50">&ge; 50</option>
            <option value="30">&ge; 30</option>
          </select>

          {/* Replacement Signal */}
          <select
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="">Replacement: Any</option>
            <option value="YES">Replacement: YES</option>
            <option value="NO">Replacement: NO</option>
            <option value="UNKNOWN">Replacement: UNKNOWN</option>
          </select>

          {/* Decision Maker Filter */}
          <select
            value={hasDm}
            onChange={(e) => setHasDm(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="">Decision Maker: Any</option>
            <option value="yes">DM Identified</option>
            <option value="no">DM Not Found</option>
          </select>

          {/* Direct Line Filter */}
          <select
            value={hasDirect}
            onChange={(e) => setHasDirect(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="">Direct Contact: Any</option>
            <option value="yes">Direct Phone Available</option>
            <option value="no">Company Line Only / None</option>
          </select>
        </div>

        {/* Filter tags & count */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
          <span>
            Showing <strong className="text-white">{filtered.length}</strong> of{" "}
            <strong>{initialRows.length}</strong> leads in review
          </span>
          {(q || stateFilter || minScore || replacement || hasDm || hasDirect) && (
            <button
              onClick={() => {
                setQ("");
                setStateFilter("");
                setMinScore("");
                setReplacement("");
                setInstallation("");
                setFinancing("");
                setHasDm("");
                setHasDirect("");
                setSoftware("");
              }}
              className="text-cyan-400 hover:underline"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Leads Table / Cards */}
      {filtered.length === 0 ? (
        <div className="p-12 text-center rounded-xl border border-slate-800 bg-slate-900/30 text-slate-400 space-y-2">
          <p className="text-sm font-semibold text-slate-300">No leads match your current criteria</p>
          <p className="text-xs">
            Intake candidate companies via Discover Leads tab or relax review filters.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/40">
          <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800">
            <thead className="bg-slate-950/80 text-[11px] font-semibold uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Company &amp; Location</th>
                <th className="px-3 py-3">Score &amp; Conf</th>
                <th className="px-3 py-3">Best Contact &amp; Decision Maker</th>
                <th className="px-3 py-3">Verified Signals</th>
                <th className="px-3 py-3">Evidence</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-4 py-3 text-right">Review Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map((lead) => {
                const repDisplay = triFactDisplay(lead.facts.replacement);
                const instDisplay = triFactDisplay(lead.facts.installation);
                const finDisplay = triFactDisplay(lead.facts.financing);

                return (
                  <tr
                    key={lead.id}
                    className="hover:bg-slate-800/40 transition-colors group"
                  >
                    {/* Company Column */}
                    <td className="px-4 py-3.5 max-w-[240px]">
                      <div className="space-y-0.5">
                        <Link
                          href={`/company/${lead.id}`}
                          className="font-bold text-white hover:text-cyan-300 hover:underline flex items-center gap-1.5 truncate"
                        >
                          <span>{lead.name}</span>
                        </Link>

                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                          <span>
                            {lead.city ?? "No City"}, {lead.state ?? "No State"}
                          </span>
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lead.name} ${lead.address || ""} ${lead.city || ""} ${lead.state || ""}`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-amber-400/90 hover:text-amber-300 hover:underline inline-flex items-center gap-0.5 ml-1"
                            title="Open Google Maps search"
                          >
                            <MapPin className="w-2.5 h-2.5 text-amber-400" />
                            <span>Maps</span>
                          </a>
                        </div>

                        {lead.website ? (
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-cyan-400 hover:underline inline-flex items-center gap-1 truncate max-w-[200px]"
                          >
                            <span>{lead.domain}</span>
                            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-500">No website</span>
                        )}
                      </div>
                    </td>

                    {/* Score Column */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-sm text-cyan-300">
                            {lead.icpScore !== null ? `${lead.icpScore}` : "--"}
                          </span>
                          <span className="text-[10px] text-slate-500">/ 100</span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Conf: {lead.researchConfidence !== null ? `${lead.researchConfidence}%` : "--"}
                        </div>
                      </div>
                    </td>

                    {/* Best Contact Column */}
                    <td className="px-3 py-3.5 max-w-[240px]">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <ContactGradeBadge grade={lead.best.grade} />
                          <ContactQualityBadge label={lead.best.label} />
                        </div>

                        <div className="text-xs font-semibold text-slate-200 truncate">
                          {lead.best.name ?? lead.owner?.name ?? "No Decision Maker"}
                          {lead.best.title && (
                            <span className="text-[11px] font-normal text-slate-400 block truncate">
                              {lead.best.title}
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-cyan-300 flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>{lead.best.phone ?? lead.phoneDisplay ?? "Phone: NOT FOUND"}</span>
                        </div>
                      </div>
                    </td>

                    {/* Signals Column */}
                    <td className="px-3 py-3.5">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        <FactBadge display={repDisplay} label="Replacement" />
                        <FactBadge display={instDisplay} label="Installation" />
                        {lead.facts.financing?.value === "YES" && (
                          <FactBadge display={finDisplay} label="Financing" />
                        )}
                        {lead.facts.employees?.value && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                            {lead.facts.employees.value} emps
                          </span>
                        )}
                        {lead.facts.software?.value && lead.facts.software.value !== "UNKNOWN" && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800">
                            {lead.facts.software.value}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Evidence Column */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <button
                        onClick={() => setEvidenceCompanyId(lead.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-[11px] font-medium transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5 text-cyan-400" />
                        <span>{lead.evidenceCount} Claims</span>
                      </button>
                    </td>

                    {/* Status Column */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <div className="space-y-1">
                        <LifecycleBadge status={lead.status} />
                        <div className="text-[10px] text-slate-400">
                          {lead.neverVerified ? (
                            <span className="text-slate-500">Unverified</span>
                          ) : lead.stale ? (
                            <span className="text-rose-400 font-semibold">Stale</span>
                          ) : (
                            <span>Fresh</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Actions Column */}
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {lead.status === "REJECTED" ? (
                          <button
                            onClick={() => handleRestore(lead.id)}
                            disabled={rejectingId === lead.id}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1"
                          >
                            <RotateCcw className="w-3 h-3 text-cyan-400" />
                            Restore
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => setApprovingCompanyId(lead.id)}
                              className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-600/40 text-xs font-semibold flex items-center gap-1 transition-colors"
                            >
                              <CheckCircle className="w-3 h-3 text-emerald-400" />
                              Approve
                            </button>

                            <button
                              onClick={() => handleQuickReject(lead.id)}
                              disabled={rejectingId === lead.id}
                              className="px-2 py-1 rounded bg-rose-950/40 hover:bg-rose-950/80 text-rose-300 border border-rose-900/50 text-xs font-semibold flex items-center gap-1 transition-colors"
                            >
                              <XCircle className="w-3 h-3 text-rose-400" />
                              Reject
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => setEditingLead(lead)}
                          className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                          title="Edit Company"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Evidence Drawer */}
      <EvidenceDrawer
        companyId={evidenceCompanyId}
        onClose={() => setEvidenceCompanyId(null)}
      />

      {/* Approval Safety Modal */}
      <ApprovalModal
        companyId={approvingCompanyId}
        onClose={() => setApprovingCompanyId(null)}
        onApproved={() => router.refresh()}
      />

      {/* Edit Company Modal */}
      <EditCompanyModal
        lead={editingLead}
        onClose={() => setEditingLead(null)}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
