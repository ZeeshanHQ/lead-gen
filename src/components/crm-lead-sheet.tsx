"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { logCallFeedbackAction } from "@/app/caller/actions";
import { LifecycleBadge } from "@/components/badges";
import { LeadImportModal } from "@/components/lead-import-modal";
import {
  DEFAULT_DIALER_CONFIG,
  type DialerConfig,
} from "@/server/domain/dialer";
import type { TeamPermissions } from "@/server/domain/team";
import {
  Sheet,
  Phone,
  PhoneCall,
  Download,
  Upload,
  Search,
  ExternalLink,
  MapPin,
  Calendar,
  CheckCircle2,
  Copy,
  Check,
  X,
} from "lucide-react";

export interface CrmLeadItem {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  phoneDisplay?: string | null;
  status: string;
  icpScore?: number | null;
  researchConfidence?: number | null;
  bestContact?: {
    name: string | null;
    title: string | null;
    phone: string | null;
    email: string | null;
  };
  replacement?: string;
  financing?: string;
  software?: string;
  notes?: string | null;
  nextFollowUp?: string | null;
  researchSummary?: string | null;
  approvedAt?: string | Date | null;
}

interface CrmLeadSheetProps {
  initialLeads: CrmLeadItem[];
  nicheName?: string;
  title?: string;
  subtitle?: string;
  showCallerLink?: boolean;
  dialerConfig?: DialerConfig;
  permissions?: TeamPermissions;
  activeActorName?: string;
}

export function CrmLeadSheet({
  initialLeads,
  nicheName,
  title = "Approved Leads",
  subtitle = "View leads, dial prospects, and save call notes or follow-ups.",
  showCallerLink = true,
  permissions,
  activeActorName = "Team Member",
}: CrmLeadSheetProps) {
  const [leads, setLeads] = useState<CrmLeadItem[]>(initialLeads);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  React.useEffect(() => {
    setLeads(initialLeads);
  }, [initialLeads]);

  // Quick Call Modal State
  const [selectedLead, setSelectedLead] = useState<CrmLeadItem | null>(null);
  const [outcome, setOutcome] = useState<
    | "CONNECTED"
    | "MEETING_BOOKED"
    | "GATEKEEPER_BLOCKED"
    | "WRONG_NUMBER"
    | "NO_ANSWER"
    | "CALL_COMPLETED"
  >("CONNECTED");
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [actor, setActor] = useState(activeActorName);
  const [isPending, startTransition] = useTransition();
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const canImport = !permissions || permissions.discoverLeads;
  const canExport = !permissions || permissions.exportAndSync;
  const canCall = !permissions || permissions.callerWorkbench;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter leads
  const filteredLeads = leads.filter((lead) => {
    if (statusFilter === "TO_CALL") {
      if (!["APPROVED", "SYNCED", "CALLING"].includes(lead.status)) return false;
    } else if (statusFilter === "CONNECTED") {
      if (!["CONNECTED", "PAIN_FOUND"].includes(lead.status)) return false;
    } else if (statusFilter === "MEETINGS") {
      if (lead.status !== "MEETING_BOOKED") return false;
    } else if (statusFilter === "FOLLOW_UP") {
      if (!lead.nextFollowUp && !(lead.notes && lead.notes.includes("Follow-up Scheduled")))
        return false;
    } else if (statusFilter !== "ALL") {
      if (lead.status !== statusFilter) return false;
    }

    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const contactName = lead.bestContact?.name || "";
    const phone = lead.bestContact?.phone || lead.phoneDisplay || "";
    return (
      lead.name.toLowerCase().includes(q) ||
      (lead.city && lead.city.toLowerCase().includes(q)) ||
      (lead.state && lead.state.toLowerCase().includes(q)) ||
      contactName.toLowerCase().includes(q) ||
      phone.includes(q) ||
      (lead.notes && lead.notes.toLowerCase().includes(q))
    );
  });

  const openCallModal = (lead: CrmLeadItem) => {
    setSelectedLead(lead);
    setOutcome("CONNECTED");
    setNotes("");
    setFollowUpDate(lead.nextFollowUp || "");
  };

  const handleSaveCall = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;

    if (!notes.trim()) {
      alert("Please enter a short call note.");
      return;
    }

    startTransition(async () => {
      const combinedNotes = followUpDate
        ? `[Next Follow-up Scheduled: ${followUpDate}] ${notes.trim()}`
        : notes.trim();

      const res = await logCallFeedbackAction({
        companyId: selectedLead.id,
        actor: actor.trim() || activeActorName,
        callOutcome: outcome,
        callerNotes: combinedNotes,
      });

      if (res.success && res.nextStatus) {
        setLeads((prev) =>
          prev.map((item) =>
            item.id === selectedLead.id
              ? {
                  ...item,
                  status: res.nextStatus!,
                  nextFollowUp: followUpDate || item.nextFollowUp,
                  notes: item.notes
                    ? `${item.notes}\n[Call ${new Date().toISOString().slice(0, 10)}] ${combinedNotes}`
                    : `[Call ${new Date().toISOString().slice(0, 10)}] ${combinedNotes}`,
                }
              : item
          )
        );
        setSelectedLead(null);
      } else {
        alert(res.error || "Could not save call");
      }
    });
  };

  // Filter counters
  const totalCount = leads.length;
  const toCallCount = leads.filter((l) =>
    ["APPROVED", "SYNCED", "CALLING"].includes(l.status)
  ).length;
  const connectedCount = leads.filter((l) =>
    ["CONNECTED", "PAIN_FOUND"].includes(l.status)
  ).length;
  const meetingsCount = leads.filter((l) => l.status === "MEETING_BOOKED").length;
  const followUpCount = leads.filter(
    (l) => l.nextFollowUp || (l.notes && l.notes.includes("Follow-up Scheduled"))
  ).length;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-[#121215]">
      {/* Top Header Bar */}
      <div className="flex flex-col items-start justify-between gap-4 border-b border-zinc-800/80 p-5 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-white">{title}</h2>
            <span className="rounded-md border border-zinc-800 bg-[#09090b] px-2 py-0.5 text-xs font-medium text-zinc-300">
              {totalCount} leads
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {canImport && (
            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 hover:text-white"
            >
              <Upload className="w-3.5 h-3.5 text-zinc-400" />
              <span>Import CSV</span>
            </button>
          )}

          {canExport && (
            <a
              href="/api/export/csv"
              download
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 hover:text-white"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400" />
              <span>Export CSV</span>
            </a>
          )}

          {showCallerLink && canCall && (
            <Link
              href="/caller"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-1.5 text-xs font-bold text-black transition hover:bg-zinc-200"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Caller Cards</span>
            </Link>
          )}
        </div>
      </div>

      {/* Feedback Alert */}
      {syncFeedback && (
        <div className="flex items-center justify-between border-b border-zinc-800 bg-[#09090b] px-5 py-2.5 text-xs text-zinc-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{syncFeedback}</span>
          </div>
          <button onClick={() => setSyncFeedback(null)} className="text-zinc-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 bg-[#09090b]/60 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          {[
            { key: "ALL", label: `All (${totalCount})` },
            { key: "TO_CALL", label: `Ready to Call (${toCallCount})` },
            { key: "FOLLOW_UP", label: `Follow-Ups (${followUpCount})` },
            { key: "CONNECTED", label: `Connected (${connectedCount})` },
            { key: "MEETINGS", label: `Meetings Booked (${meetingsCount})` },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                statusFilter === tab.key
                  ? "bg-white text-black font-bold"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search company, owner, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-[#09090b] pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Spreadsheet Table View */}
      {filteredLeads.length === 0 ? (
        <div className="p-10 text-center text-xs text-zinc-400 space-y-3">
          <Sheet className="w-7 h-7 text-zinc-600 mx-auto" />
          <p className="font-semibold text-sm text-zinc-200">
            No leads found for {nicheName ? `"${nicheName}"` : "this filter"}
          </p>
          <p className="max-w-md mx-auto text-zinc-400">
            Find new leads for {nicheName || "this niche"} or import a CSV file.
          </p>
          <div className="flex items-center justify-center gap-2.5 pt-1">
            {canImport && (
              <>
                <Link
                  href="/discover"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-1.5 text-xs font-bold text-black hover:bg-zinc-200"
                >
                  <span>+ Find Leads</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setImportModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import CSV</span>
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300 divide-y divide-zinc-800/70">
            <thead className="bg-[#09090b] text-[11px] font-medium text-zinc-400">
              <tr>
                <th className="px-4 py-3">Company &amp; Location</th>
                <th className="px-3 py-3">Contact Person</th>
                <th className="px-3 py-3">Phone</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Next Follow-Up</th>
                <th className="px-3 py-3">Latest Note</th>
                <th className="px-3 py-3">Score</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filteredLeads.map((lead) => {
                const phone = lead.bestContact?.phone || lead.phoneDisplay;
                const dmName = lead.bestContact?.name;
                const dmTitle = lead.bestContact?.title;
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${lead.name} ${lead.address || ""} ${lead.city || ""} ${lead.state || ""}`
                )}`;

                return (
                  <tr key={lead.id} className="hover:bg-zinc-900/60 transition-colors">
                    {/* Company & Location */}
                    <td className="px-4 py-3.5 max-w-[220px]">
                      <div className="font-semibold text-white text-xs truncate">
                        <Link href={`/company/${lead.id}`} className="hover:underline">
                          {lead.name}
                        </Link>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-400 truncate mt-0.5">
                        <span>{lead.city ? `${lead.city}, ${lead.state}` : lead.state || "US"}</span>
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-0.5"
                          title="Open in Google Maps"
                        >
                          <MapPin className="w-2.5 h-2.5" />
                          <span>Map</span>
                        </a>
                        {lead.website && (
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-0.5"
                            title="Visit website"
                          >
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </td>

                    {/* Contact Person */}
                    <td className="px-3 py-3.5 max-w-[180px]">
                      {dmName ? (
                        <div>
                          <div className="font-medium text-zinc-200 text-xs truncate">{dmName}</div>
                          <div className="text-[11px] text-zinc-400 truncate">{dmTitle || "Owner"}</div>
                        </div>
                      ) : (
                        <span className="text-zinc-500 text-[11px]">Main Office</span>
                      )}
                    </td>

                    {/* Phone */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      {phone ? (
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`tel:${phone}`}
                            className="font-mono font-bold text-emerald-400 hover:text-emerald-300"
                          >
                            {phone}
                          </a>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(phone, lead.id)}
                            className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
                            title="Copy phone"
                          >
                            {copiedId === lead.id ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-zinc-500 text-[11px]">No phone</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <LifecycleBadge status={lead.status as any} />
                    </td>

                    {/* Follow-up */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      {lead.nextFollowUp ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                          <Calendar className="w-3 h-3 text-amber-400" />
                          <span>{lead.nextFollowUp.replace("T", " ")}</span>
                        </span>
                      ) : (
                        <span className="text-zinc-600 text-[11px]">—</span>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="px-3 py-3.5 max-w-[230px]">
                      {lead.notes ? (
                        <p className="text-[11px] text-zinc-300 truncate" title={lead.notes}>
                          {lead.notes.split("\n").pop() || lead.notes}
                        </p>
                      ) : (
                        <span className="text-zinc-500 text-[11px]">No notes yet</span>
                      )}
                    </td>

                    {/* Score */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <span className="font-bold text-emerald-400 text-xs">
                        {lead.icpScore !== null && lead.icpScore !== undefined
                          ? `${lead.icpScore}/100`
                          : "—"}
                      </span>
                    </td>

                    {/* Quick Actions */}
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      {canCall ? (
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {phone && (
                            <a
                              href={`tel:${phone}`}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 px-2.5 py-1 text-[11px] font-bold text-black transition"
                            >
                              <Phone className="w-3 h-3" />
                              <span>Call</span>
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => openCallModal(lead)}
                            className="inline-flex items-center gap-1 rounded-lg bg-white hover:bg-zinc-200 px-2.5 py-1 text-[11px] font-bold text-black transition"
                          >
                            <span>Log Call</span>
                          </button>
                        </div>
                      ) : (
                        <Link
                          href={`/company/${lead.id}`}
                          className="text-xs text-zinc-400 hover:text-white underline"
                        >
                          View
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick Call & Outcome Modal */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Log Call — {selectedLead.name}</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {selectedLead.bestContact?.name || "Owner/Manager"} &bull;{" "}
                  {selectedLead.bestContact?.phone || selectedLead.phoneDisplay || "No Phone"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLead(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCall} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-2">
                  Call Outcome *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  {[
                    { key: "MEETING_BOOKED", label: "Meeting Booked 🎯" },
                    { key: "CONNECTED", label: "Connected / Spoke" },
                    { key: "GATEKEEPER_BLOCKED", label: "Gatekeeper" },
                    { key: "NO_ANSWER", label: "No Answer" },
                    { key: "CALL_COMPLETED", label: "Left Voicemail" },
                    { key: "WRONG_NUMBER", label: "Wrong Number" },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setOutcome(opt.key as any)}
                      className={`p-2.5 rounded-lg border text-left transition ${
                        outcome === opt.key
                          ? "border-white bg-zinc-800 text-white font-bold"
                          : "border-zinc-800 bg-[#09090b] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Next Follow-Up (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:outline-none focus:border-zinc-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Call Notes *
                </label>
                <textarea
                  rows={3}
                  required
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Write a quick summary of the call..."
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                />
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setSelectedLead(null)}
                  className="px-4 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black font-bold text-xs transition"
                >
                  {isPending ? "Saving..." : "Save Call Note"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      <LeadImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImportSuccess={() => {
          setTimeout(() => {
            window.location.reload();
          }, 1200);
        }}
      />
    </div>
  );
}
