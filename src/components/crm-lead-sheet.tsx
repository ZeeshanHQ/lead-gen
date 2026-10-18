"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { logCallFeedbackAction, pushLeadsToDialerAction } from "@/app/caller/actions";
import { syncApprovedLeadsAction } from "@/app/sheets/actions";
import { LifecycleBadge } from "@/components/badges";
import { LeadImportModal } from "@/components/lead-import-modal";
import {
  buildDialerLaunchUrl,
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
  RefreshCw,
  X,
  Send,
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
  dialerConfig = DEFAULT_DIALER_CONFIG,
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
  const [syncPending, startSyncTransition] = useTransition();
  const [dialerPending, startDialerTransition] = useTransition();
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

  const handleSyncToGoogleSheets = () => {
    startSyncTransition(async () => {
      setSyncFeedback(null);
      const res = await syncApprovedLeadsAction({
        actor: activeActorName,
        dryRun: false,
      });

      if (res.success) {
        setSyncFeedback(`Synced ${res.syncedCount} leads to Google Sheets.`);
        setTimeout(() => setSyncFeedback(null), 5000);
      } else {
        setSyncFeedback(`Sync failed: ${res.error || "Check Google Sheet settings"}`);
      }
    });
  };

  const handlePushAllToDialer = () => {
    const callableLeads = filteredLeads.filter(
      (l) => l.bestContact?.phone || l.phoneDisplay
    );
    if (callableLeads.length === 0) {
      setSyncFeedback("No leads with phone numbers in the current list.");
      return;
    }
    startDialerTransition(async () => {
      setSyncFeedback(null);
      const res = await pushLeadsToDialerAction(
        callableLeads.map((l) => ({
          id: l.id,
          name: l.name,
          contactName: l.bestContact?.name,
          contactTitle: l.bestContact?.title,
          phone: l.bestContact?.phone || l.phoneDisplay,
          email: l.bestContact?.email,
          city: l.city,
          state: l.state,
          website: l.website,
          niche: nicheName,
          icpScore: l.icpScore,
          notes: l.notes,
        }))
      );
      if (res.ok) {
        setSyncFeedback(
          `Sent ${res.count} leads to ${res.platformName} (${res.campaign}).`
        );
        setTimeout(() => setSyncFeedback(null), 5000);
      } else {
        setSyncFeedback(res.error || "Could not send leads to dialer.");
      }
    });
  };

  const handleSingleLeadDial = (lead: CrmLeadItem) => {
    const phone = lead.bestContact?.phone || lead.phoneDisplay;
    if (!phone) return;
    const url = buildDialerLaunchUrl(dialerConfig.launchUrlTemplate, {
      id: lead.id,
      name: lead.name,
      phone,
      contactName: lead.bestContact?.name,
      city: lead.city,
      state: lead.state,
      niche: nicheName,
    });

    startDialerTransition(async () => {
      await pushLeadsToDialerAction([
        {
          id: lead.id,
          name: lead.name,
          contactName: lead.bestContact?.name,
          contactTitle: lead.bestContact?.title,
          phone,
          email: lead.bestContact?.email,
          city: lead.city,
          state: lead.state,
          website: lead.website,
          niche: nicheName,
          icpScore: lead.icpScore,
          notes: lead.notes,
        },
      ]);
    });

    if (typeof window !== "undefined") {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        window.location.href = url;
      }
    }
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
    <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/40">
      {/* Top Header Bar */}
      <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-800/80 p-5 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-white">{title}</h2>
            <span className="rounded-md border border-slate-800 bg-slate-950 px-2 py-0.5 text-xs font-medium text-slate-300">
              {totalCount} leads
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {canImport && (
            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              <Upload className="w-3.5 h-3.5 text-slate-400" />
              <span>Import CSV</span>
            </button>
          )}

          {canExport && (
            <>
              <a
                href="/api/export/csv"
                download
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
              >
                <Download className="w-3.5 h-3.5 text-slate-400" />
                <span>Export CSV</span>
              </a>

              <button
                type="button"
                onClick={handleSyncToGoogleSheets}
                disabled={syncPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${syncPending ? "animate-spin" : ""}`} />
                <span>Sync Sheet</span>
              </button>
            </>
          )}

          {canCall && (
            <button
              type="button"
              onClick={handlePushAllToDialer}
              disabled={dialerPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white disabled:opacity-50"
              title={`Send leads to ${dialerConfig.platformName}`}
            >
              <Send className="w-3.5 h-3.5 text-sky-400" />
              <span>Send to {dialerConfig.platformName}</span>
            </button>
          )}

          {showCallerLink && canCall && (
            <Link
              href="/caller"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-1.5 text-xs font-medium text-slate-950 transition hover:bg-slate-200"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Caller Queue</span>
            </Link>
          )}
        </div>
      </div>

      {/* Sync / Dialer Feedback Alert */}
      {syncFeedback && (
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-5 py-2.5 text-xs text-slate-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{syncFeedback}</span>
          </div>
          <button onClick={() => setSyncFeedback(null)} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/40 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          {[
            { key: "ALL", label: `All (${totalCount})` },
            { key: "TO_CALL", label: `Ready to Call (${toCallCount})` },
            { key: "CONNECTED", label: `Connected (${connectedCount})` },
            { key: "FOLLOW_UP", label: `Follow-Ups (${followUpCount})` },
            { key: "MEETINGS", label: `Meetings Booked (${meetingsCount})` },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                statusFilter === tab.key
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search company, owner, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-slate-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Spreadsheet Table View */}
      {filteredLeads.length === 0 ? (
        <div className="p-10 text-center text-xs text-slate-400 space-y-3">
          <Sheet className="w-7 h-7 text-slate-600 mx-auto" />
          <p className="font-medium text-sm text-slate-200">
            No leads found for {nicheName ? `"${nicheName}"` : "this filter"}
          </p>
          <p className="max-w-md mx-auto text-slate-400">
            Find new leads for {nicheName || "this niche"}, approve leads in the Review Queue, or import a CSV file.
          </p>
          <div className="flex items-center justify-center gap-2.5 pt-1">
            {canImport && (
              <>
                <Link
                  href="/discover"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-1.5 text-xs font-medium text-slate-950 hover:bg-slate-200"
                >
                  <span>Find Leads</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setImportModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
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
          <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800/70">
            <thead className="bg-slate-950/60 text-[11px] font-medium text-slate-400">
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
            <tbody className="divide-y divide-slate-800/60">
              {filteredLeads.map((lead) => {
                const phone = lead.bestContact?.phone || lead.phoneDisplay;
                const dmName = lead.bestContact?.name;
                const dmTitle = lead.bestContact?.title;
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${lead.name} ${lead.address || ""} ${lead.city || ""} ${lead.state || ""}`
                )}`;

                return (
                  <tr key={lead.id} className="hover:bg-slate-900/60 transition-colors">
                    {/* Company & Location */}
                    <td className="px-4 py-3.5 max-w-[220px]">
                      <div className="font-medium text-white text-xs truncate">
                        <Link href={`/company/${lead.id}`} className="hover:underline">
                          {lead.name}
                        </Link>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 truncate mt-0.5">
                        <span>{lead.city ? `${lead.city}, ${lead.state}` : lead.state || "US"}</span>
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-400 hover:text-slate-200 inline-flex items-center gap-0.5"
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
                            className="text-slate-400 hover:text-slate-200 inline-flex items-center gap-0.5"
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
                          <div className="font-medium text-slate-200 text-xs truncate">{dmName}</div>
                          <div className="text-[11px] text-slate-400 truncate">{dmTitle || "Owner"}</div>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-[11px]">Main Office</span>
                      )}
                    </td>

                    {/* Phone */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      {phone ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-200">{phone}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(phone, lead.id)}
                            className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors"
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
                        <span className="text-slate-500 text-[11px]">No phone</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <LifecycleBadge status={lead.status as any} />
                    </td>

                    {/* Follow-up */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      {lead.nextFollowUp ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                          <Calendar className="w-3 h-3 text-amber-400" />
                          <span>{lead.nextFollowUp.replace("T", " ")}</span>
                        </span>
                      ) : (
                        <span className="text-slate-600 text-[11px]">—</span>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="px-3 py-3.5 max-w-[230px]">
                      {lead.notes ? (
                        <p className="text-[11px] text-slate-300 truncate" title={lead.notes}>
                          {lead.notes.split("\n").pop() || lead.notes}
                        </p>
                      ) : (
                        <span className="text-slate-500 text-[11px]">No notes yet</span>
                      )}
                    </td>

                    {/* Score */}
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <span className="font-medium text-slate-200 text-xs">
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
                            <button
                              type="button"
                              onClick={() => handleSingleLeadDial(lead)}
                              className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-slate-950 transition hover:bg-slate-200"
                              title={`Dial in ${dialerConfig.platformName}`}
                            >
                              <Phone className="w-3 h-3" />
                              <span>Dial</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openCallModal(lead)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-800/70 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
                          >
                            <span>Log Call</span>
                          </button>
                        </div>
                      ) : (
                        <Link
                          href={`/company/${lead.id}`}
                          className="text-xs text-slate-400 hover:text-white underline"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Log Call — {selectedLead.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedLead.bestContact?.name || "Owner/Manager"} &bull;{" "}
                  {selectedLead.bestContact?.phone || selectedLead.phoneDisplay || "No Phone"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLead(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCall} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-2">
                  Call Outcome *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  {[
                    { key: "MEETING_BOOKED", label: "Meeting Booked" },
                    { key: "CONNECTED", label: "Connected / Spoke" },
                    { key: "GATEKEEPER_BLOCKED", label: "Gatekeeper" },
                    { key: "NO_ANSWER", label: "No Answer" },
                    { key: "WRONG_NUMBER", label: "Wrong Number" },
                    { key: "CALL_COMPLETED", label: "Left Voicemail" },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setOutcome(opt.key as any)}
                      className={`p-2.5 rounded-lg border text-left transition ${
                        outcome === opt.key
                          ? "border-slate-500 bg-slate-800 text-white font-medium"
                          : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Next Follow-Up (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Call Notes *
                </label>
                <textarea
                  rows={3}
                  required
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Write a quick summary of the call..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Called By</label>
                <input
                  type="text"
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-slate-600"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setSelectedLead(null)}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-slate-200 text-slate-950 font-medium text-xs transition"
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
