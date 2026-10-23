"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { type CallerLeadView } from "@/server/repo/caller";
import { logCallFeedbackAction, pushLeadsToDialerAction, assignLeadAction, autoDistributeLeadsAction } from "./actions";
import { type TeamMember, ROLE_PRESETS } from "@/server/domain/team";
import { LifecycleBadge } from "@/components/badges";
import { CrmLeadSheet, type CrmLeadItem } from "@/components/crm-lead-sheet";
import {
  buildDialerLaunchUrl,
  DEFAULT_DIALER_CONFIG,
  type DialerConfig,
} from "@/server/domain/dialer";
import type { TeamPermissions } from "@/server/domain/team";
import {
  PhoneCall,
  Phone,
  ExternalLink,
  CheckCircle2,
  Copy,
  Check,
  Search,
  Building2,
  Calendar,
  X,
  MapPin,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Download,
  Send,
  Settings,
  Sparkles,
  Users,
  UserCheck,
} from "lucide-react";

interface CallerClientProps {
  initialQueue: CallerLeadView[];
  nicheName?: string;
  marketId?: string;
  dialerConfig?: DialerConfig;
  activeActorName?: string;
  activeMember?: TeamMember;
  allMembers?: TeamMember[];
  permissions?: TeamPermissions;
}

export function CallerClient({
  initialQueue,
  nicheName = "Active Niche",
  marketId,
  dialerConfig = DEFAULT_DIALER_CONFIG,
  activeActorName = "Sales Caller",
  activeMember,
  allMembers = [],
  permissions,
}: CallerClientProps) {
  const [queue, setQueue] = useState<CallerLeadView[]>(initialQueue);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(
    activeMember?.role === "CALLER" ? "MY_LEADS" : "TO_CALL"
  );
  const [distributePending, startDistribute] = useTransition();
  const [assignPendingId, setAssignPendingId] = useState<string | null>(null);

  const handleAutoDistribute = () => {
    if (!marketId) return;
    startDistribute(async () => {
      const res = await autoDistributeLeadsAction({ marketId });
      if (res.ok) {
        setDialerToast(`⚡ Distributed ${res.distributedCount} leads evenly across ${res.membersCount} active callers.`);
        setTimeout(() => setDialerToast(null), 4000);
        window.location.reload();
      } else {
        alert(res.error || "Failed to distribute leads");
      }
    });
  };

  const handleAssignLead = async (leadId: string, memberId: string) => {
    setAssignPendingId(leadId);
    const target = allMembers.find((m) => m.id === memberId);
    const res = await assignLeadAction({
      companyId: leadId,
      memberId: memberId || null,
      memberName: target?.name || null,
    });
    setAssignPendingId(null);
    if (res.ok) {
      setQueue((prev) =>
        prev.map((l) =>
          l.companyId === leadId
            ? { ...l, assignedMemberId: memberId || null, assignedMemberName: target?.name || null }
            : l
        )
      );
    }
  };
  const [selectedLead, setSelectedLead] = useState<CallerLeadView | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"CARDS" | "SHEET">("CARDS");

  // Form state for Log Call modal
  const [isPending, startTransition] = useTransition();
  const [dialerPending, startDialerTransition] = useTransition();
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmedSoftware, setConfirmedSoftware] = useState("");
  const [confirmedFleet, setConfirmedFleet] = useState<string>("");
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [dialerToast, setDialerToast] = useState<string | null>(null);

  const canExport = !permissions || permissions.exportAndSync;
  const canManageSettings = !permissions || permissions.manageTeamAndSettings;

  // Filtered queue
  const filteredQueue = queue.filter((lead) => {
    if (statusFilter === "MY_LEADS") {
      if (!activeMember || lead.assignedMemberId !== activeMember.id) return false;
    } else if (statusFilter === "TO_CALL") {
      if (!["APPROVED", "SYNCED", "CALLING"].includes(lead.status)) return false;
    } else if (statusFilter === "CONNECTED") {
      if (!["CONNECTED", "PAIN_FOUND"].includes(lead.status)) return false;
    } else if (statusFilter === "MEETINGS") {
      if (lead.status !== "MEETING_BOOKED") return false;
    } else if (statusFilter === "FOLLOW_UP") {
      if (!lead.nextFollowUp && !(lead.notes && lead.notes.includes("Follow-up Scheduled")))
        return false;
    } else if (statusFilter === "NEEDS_REVIEW") {
      if (lead.status !== "NEEDS_REVIEW") return false;
    } else if (statusFilter !== "ALL") {
      if (lead.status !== statusFilter) return false;
    }

    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      lead.name.toLowerCase().includes(q) ||
      (lead.city && lead.city.toLowerCase().includes(q)) ||
      (lead.state && lead.state.toLowerCase().includes(q)) ||
      (lead.bestContact.name && lead.bestContact.name.toLowerCase().includes(q)) ||
      (lead.phone && lead.phone.includes(q)) ||
      (lead.bestContact.phone && lead.bestContact.phone.includes(q)) ||
      (lead.notes && lead.notes.toLowerCase().includes(q)) ||
      (lead.assignedMemberName && lead.assignedMemberName.toLowerCase().includes(q))
    );
  });

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openLogCallModal = (lead: CallerLeadView) => {
    setSelectedLead(lead);
    setOutcome("CONNECTED");
    setNotes("");
    setFollowUpDate(lead.nextFollowUp || "");
    const detectedSoft = lead.software && lead.software !== "UNKNOWN" ? lead.software : "";
    setConfirmedSoftware(detectedSoft);
    setConfirmedFleet("");
    setShowAdvanced(false);
    setFeedbackMessage(null);
  };

  const handleDialInPlatform = (lead: CallerLeadView) => {
    const dialPhone = lead.bestContact.phone || lead.phone;
    if (!dialPhone) return;

    const url = buildDialerLaunchUrl(dialerConfig.launchUrlTemplate, {
      id: lead.companyId,
      name: lead.name,
      phone: dialPhone,
      contactName: lead.bestContact.name,
      city: lead.city,
      state: lead.state,
      niche: nicheName,
    });

    startDialerTransition(async () => {
      const res = await pushLeadsToDialerAction([
        {
          id: lead.companyId,
          name: lead.name,
          contactName: lead.bestContact.name,
          contactTitle: lead.bestContact.title,
          phone: dialPhone,
          email: lead.bestContact.email,
          city: lead.city,
          state: lead.state,
          website: lead.website,
          niche: nicheName,
          icpScore: lead.icpScore,
          notes: lead.notes,
        },
      ]);
      if (res.ok) {
        setDialerToast(`Sent ${lead.name} to ${res.platformName}.`);
        setTimeout(() => setDialerToast(null), 3500);
      }
    });

    if (typeof window !== "undefined") {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        window.location.href = url;
      }
    }
  };

  const handlePushQueueToDialer = () => {
    const callable = filteredQueue.filter((l) => l.bestContact.phone || l.phone);
    if (!callable.length) {
      setDialerToast("No leads with phone numbers in this view.");
      return;
    }

    startDialerTransition(async () => {
      const res = await pushLeadsToDialerAction(
        callable.map((l) => ({
          id: l.companyId,
          name: l.name,
          contactName: l.bestContact.name,
          contactTitle: l.bestContact.title,
          phone: l.bestContact.phone || l.phone,
          email: l.bestContact.email,
          city: l.city,
          state: l.state,
          website: l.website,
          niche: nicheName,
          icpScore: l.icpScore,
          notes: l.notes,
        }))
      );
      if (res.ok) {
        setDialerToast(
          `Sent ${res.count} leads to ${res.platformName} (${res.campaign}).`
        );
        setTimeout(() => setDialerToast(null), 4000);
      } else {
        setDialerToast(res.error || "Could not send leads to dialer.");
      }
    });
  };

  const handleLogCallSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;

    if (!notes.trim()) {
      setFeedbackMessage({
        type: "error",
        text: "Please enter a short note about the call.",
      });
      return;
    }

    startTransition(async () => {
      const fleetNum = confirmedFleet.trim() ? parseInt(confirmedFleet.trim(), 10) : null;
      const combinedNotes = followUpDate
        ? `[Next Follow-up Scheduled: ${followUpDate}] ${notes.trim()}`
        : notes.trim();

      const res = await logCallFeedbackAction({
        companyId: selectedLead.companyId,
        actor: actor.trim() || activeActorName,
        callOutcome: outcome,
        softwareConfirmed: confirmedSoftware.trim() || null,
        fleetSizeConfirmed: fleetNum && !isNaN(fleetNum) ? fleetNum : null,
        callerNotes: combinedNotes,
      });

      if (res.success && res.nextStatus) {
        setQueue((prev) =>
          prev.map((item) =>
            item.companyId === selectedLead.companyId
              ? {
                  ...item,
                  status: res.nextStatus!,
                  software: confirmedSoftware.trim() || item.software,
                  nextFollowUp: followUpDate || item.nextFollowUp,
                  notes: item.notes
                    ? `${item.notes}\n[Call ${new Date().toISOString().slice(0, 10)}] ${combinedNotes}`
                    : `[Call ${new Date().toISOString().slice(0, 10)}] ${combinedNotes}`,
                }
              : item
          )
        );
        setFeedbackMessage({
          type: "success",
          text: "Call saved.",
        });
        setTimeout(() => {
          setSelectedLead(null);
          setFeedbackMessage(null);
        }, 900);
      } else {
        setFeedbackMessage({
          type: "error",
          text: res.error || "Could not save call.",
        });
      }
    });
  };

  // Convert queue to CrmLeadItem format for Sheet View
  const crmLeadsFromQueue: CrmLeadItem[] = queue.map((l) => ({
    id: l.companyId,
    name: l.name,
    address: l.address,
    city: l.city,
    state: l.state,
    website: l.website,
    phoneDisplay: l.phone,
    status: l.status,
    icpScore: l.icpScore,
    researchConfidence: l.confidence,
    bestContact: {
      name: l.bestContact.name,
      title: l.bestContact.title,
      phone: l.bestContact.phone,
      email: l.bestContact.email,
    },
    replacement: l.replacement,
    financing: l.financing,
    software: l.software,
    notes: l.notes,
    nextFollowUp: l.nextFollowUp,
    researchSummary: l.researchSummary,
  }));

  // Counters
  const totalCount = queue.length;
  const toCallCount = queue.filter((l) =>
    ["APPROVED", "SYNCED", "CALLING"].includes(l.status)
  ).length;
  const connectedCount = queue.filter((l) =>
    ["CONNECTED", "PAIN_FOUND"].includes(l.status)
  ).length;
  const meetingsCount = queue.filter((l) => l.status === "MEETING_BOOKED").length;
  const followUpCount = queue.filter(
    (l) => l.nextFollowUp || (l.notes && l.notes.includes("Follow-up Scheduled"))
  ).length;
  const myLeadsCount = queue.filter(
    (l) => activeMember && l.assignedMemberId === activeMember.id
  ).length;
  const needsReviewCount = queue.filter((l) => l.status === "NEEDS_REVIEW").length;
  const unassignedCount = queue.filter(
    (l) => !l.assignedMemberId && ["APPROVED", "CALLING", "SYNCED"].includes(l.status)
  ).length;

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Niche: {nicheName}</span>
            <span>•</span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Dialer: {dialerConfig.platformName} ({dialerConfig.defaultCampaign})
            </span>
            {canManageSettings && (
              <Link
                href="/settings?tab=dialer"
                className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:underline"
              >
                <Settings className="w-3 h-3" />
                <span>Dialer Settings</span>
              </Link>
            )}
          </div>
          <h1 className="mt-1 text-xl font-semibold text-white">
            Caller Queue — {nicheName}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Dial leads directly in {dialerConfig.platformName}, view the call script, and save call outcomes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center p-0.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-medium">
            <button
              type="button"
              onClick={() => setViewMode("CARDS")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                viewMode === "CARDS"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Dialer Cards</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("SHEET")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                viewMode === "SHEET"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Table View</span>
            </button>
          </div>

          {canManageSettings && unassignedCount > 0 && (
            <button
              type="button"
              onClick={handleAutoDistribute}
              disabled={distributePending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3.5 py-2 text-xs font-semibold transition disabled:opacity-50 shadow-sm"
              title={`Distribute ${unassignedCount} unassigned leads evenly among active callers`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {distributePending
                  ? "Distributing..."
                  : `Auto-distribute (${unassignedCount})`}
              </span>
            </button>
          )}

          <Link
            href="/discover"
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 px-3.5 py-2 text-xs font-semibold transition shadow-sm"
          >
            <Search className="w-3.5 h-3.5" />
            <span>+ Find Leads</span>
          </Link>

          <button
            type="button"
            onClick={handlePushQueueToDialer}
            disabled={dialerPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>
              {dialerPending
                ? "Sending..."
                : `Send Queue to ${dialerConfig.platformName}`}
            </span>
          </button>

          {canExport && (
            <a
              href="/api/export/csv"
              download
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span>Export CSV</span>
            </a>
          )}
        </div>
      </div>

      {/* Dialer Toast */}
      {dialerToast && (
        <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-medium text-slate-200">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>{dialerToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setDialerToast(null)}
            className="text-slate-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {viewMode === "SHEET" ? (
        <CrmLeadSheet
          initialLeads={crmLeadsFromQueue}
          nicheName={nicheName}
          title={`${nicheName} — Calling Sheet`}
          subtitle="Tabular view of all leads in the calling queue."
          showCallerLink={false}
          dialerConfig={dialerConfig}
          permissions={permissions}
          activeActorName={activeActorName}
        />
      ) : (
        <div className="space-y-4">
          {/* Filters and Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-900/40 p-3.5">
            <div className="flex flex-wrap items-center gap-1">
              {[
                { key: "TO_CALL", label: `Ready to Call (${toCallCount})` },
                { key: "MY_LEADS", label: `My Leads (${myLeadsCount})` },
                { key: "MEETINGS", label: `Meetings Booked 🎯 (${meetingsCount})` },
                { key: "FOLLOW_UP", label: `Follow-Ups (${followUpCount})` },
                { key: "CONNECTED", label: `Connected (${connectedCount})` },
                { key: "NEEDS_REVIEW", label: `Needs a Look (${needsReviewCount})` },
                { key: "ALL", label: `All Leads (${totalCount})` },
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

            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search company, contact, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-slate-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Lead Cards List */}
          {filteredQueue.length === 0 ? (
            <div className="p-12 text-center rounded-xl border border-slate-800/80 bg-slate-900/30 text-slate-400 space-y-3">
              <PhoneCall className="w-7 h-7 text-slate-600 mx-auto" />
              <p className="text-sm font-medium text-slate-200">No leads in this view</p>
              <p className="text-xs">
                Click "+ Find Leads" above to discover qualified leads in 1 click, or switch tabs to view all leads.
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {filteredQueue.map((lead) => {
                const dialPhone = lead.bestContact.phone || lead.phone;
                const dmName = lead.bestContact.name;
                const dmTitle = lead.bestContact.title;
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${lead.name} ${lead.address || ""} ${lead.city || ""} ${lead.state || ""}`
                )}`;

                const scriptText = `Hi ${dmName || "there"}, I noticed ${lead.name} serves ${
                  lead.city || "your area"
                } in ${nicheName}. We help local businesses capture high-intent inquiries and book more appointments automatically. Do you have 2 minutes to see how it works?`;

                return (
                  <div
                    key={lead.companyId}
                    className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-5 space-y-4 transition hover:border-slate-700"
                  >
                    {/* Top Row: Company Info & Score */}
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <h2 className="text-base font-semibold text-white hover:underline">
                            <Link href={`/company/${lead.companyId}`}>{lead.name}</Link>
                          </h2>
                          <LifecycleBadge status={lead.status} />
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1">
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5 text-slate-500" />
                            <span>
                              {lead.city ? `${lead.city}, ${lead.state}` : lead.state || "US"}
                            </span>
                          </span>

                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-white flex items-center gap-1"
                          >
                            <MapPin className="w-3 h-3" />
                            <span>Google Maps</span>
                          </a>

                          {lead.website && (
                            <a
                              href={lead.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-400 hover:text-white flex items-center gap-1"
                            >
                              <span>
                                {lead.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                              </span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[11px] text-slate-500 flex items-center gap-1">
                            <Users className="w-3 h-3 text-slate-500" />
                            <span>Assigned Caller:</span>
                          </span>
                          {allMembers && allMembers.length > 0 && canManageSettings ? (
                            <select
                              value={lead.assignedMemberId || ""}
                              onChange={(e) => handleAssignLead(lead.companyId, e.target.value)}
                              disabled={assignPendingId === lead.companyId}
                              className="rounded border border-slate-800 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300 focus:border-sky-500 focus:outline-none"
                            >
                              <option value="">Unassigned</option>
                              {allMembers
                                .filter((m) => m.status === "ACTIVE" && m.role !== "VIEWER")
                                .map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name} ({ROLE_PRESETS[m.role]?.shortLabel || m.role})
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <span className="text-[11px] font-medium text-slate-300">
                              {lead.assignedMemberName ? `👤 ${lead.assignedMemberName}` : "Unassigned"}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[11px] text-slate-400">Score</div>
                        <div className="text-sm font-semibold text-white">
                          {lead.icpScore}/100
                        </div>
                      </div>
                    </div>

                    {/* Calling Bar */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-lg border border-slate-800 bg-slate-950/70 p-4 items-center">
                      <div>
                        <div className="text-[11px] text-slate-400">Contact Person</div>
                        <div className="font-medium text-sm text-white mt-0.5">
                          {dmName || "Owner / Manager"}
                        </div>
                        <div className="text-xs text-slate-400">
                          {dmTitle || "Decision Maker"}
                        </div>
                      </div>

                      <div className="flex flex-col items-start md:items-center">
                        <div className="text-[11px] text-slate-400 mb-1">Phone Number</div>
                        {dialPhone ? (
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-white">
                              {dialPhone}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(dialPhone, lead.companyId)}
                              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
                              title="Copy Phone"
                            >
                              {copiedId === lead.companyId ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">No phone listed</span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-start md:justify-end gap-2">
                        {dialPhone && (
                          <button
                            type="button"
                            onClick={() => handleDialInPlatform(lead)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-medium text-slate-950 transition hover:bg-slate-200"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>Dial in {dialerConfig.platformName}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openLogCallModal(lead)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          <span>Log Call</span>
                        </button>
                      </div>
                    </div>

                    {/* Follow-up & Past Notes */}
                    {(lead.nextFollowUp || lead.notes) && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {lead.nextFollowUp && (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 font-medium">
                            <Calendar className="w-3.5 h-3.5 text-amber-400" />
                            <span>Follow-Up: {lead.nextFollowUp.replace("T", " at ")}</span>
                          </span>
                        )}
                        {lead.notes && (
                          <span className="text-slate-400 text-xs truncate max-w-xl">
                            Last Note:{" "}
                            <span className="text-slate-200">
                              {lead.notes.split("\n").pop()}
                            </span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Call Script */}
                    <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-3.5 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-300">Suggested Opening Script</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(scriptText, `script_${lead.companyId}`)}
                          className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
                        >
                          {copiedId === `script_${lead.companyId}` ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-slate-400 leading-relaxed">&ldquo;{scriptText}&rdquo;</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Call Outcome Modal */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Log Call — {selectedLead.name}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedLead.bestContact.name || "Owner/Manager"} &bull;{" "}
                  {selectedLead.bestContact.phone || selectedLead.phone || "No phone"}
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

            {feedbackMessage && (
              <div
                className={`px-6 py-2.5 text-xs flex items-center gap-2 border-b ${
                  feedbackMessage.type === "success"
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                    : "bg-rose-500/10 text-rose-300 border-rose-500/30"
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{feedbackMessage.text}</span>
              </div>
            )}

            <form onSubmit={handleLogCallSubmit} className="p-6 space-y-4">
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
                  placeholder="Write a short summary of the call..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-slate-600"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                >
                  {showAdvanced ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  <span>{showAdvanced ? "Hide extra fields" : "Add software or team size"}</span>
                </button>

                {showAdvanced && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 mb-1">
                        Software Used
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. ServiceTitan, Jobber, HubSpot"
                        value={confirmedSoftware}
                        onChange={(e) => setConfirmedSoftware(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-300 mb-1">
                        Team / Fleet Size
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="500"
                        placeholder="e.g. 10"
                        value={confirmedFleet}
                        onChange={(e) => setConfirmedFleet(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                      />
                    </div>
                  </div>
                )}
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
                  {isPending ? "Saving..." : "Save Call"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
