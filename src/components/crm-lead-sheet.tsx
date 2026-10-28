"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import {
  logCallFeedbackAction,
  updateLeadCrmDetailsAction,
  updateLeadFollowUpAction,
  updateLeadStatusQuickAction,
  deleteCrmLeadAction,
  updateLeadSmartFieldAction,
  assignLeadAction,
} from "@/app/caller/actions";
import { LeadImportModal } from "@/components/lead-import-modal";
import {
  DEFAULT_DIALER_CONFIG,
  type DialerConfig,
} from "@/server/domain/dialer";
import {
  getSmartFieldsForNiche,
  resolveSmartFieldValue,
  type CustomCrmColumn,
  type NicheSmartField,
} from "@/server/domain/niche-fields";
import type { TeamPermissions, TeamMember } from "@/server/domain/team";
import type { LifecycleStatus } from "@/server/domain/lifecycle";
import { classifyLeadDate } from "@/components/crm-date-utils";
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
  Pencil,
  Plus,
  Trash2,
  Clock,
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
  facts?: Record<string, string>;
  financingObserved?: boolean;
  installSignalObserved?: boolean;
  onlineBookingObserved?: boolean;
  notes?: string | null;
  nextFollowUp?: string | null;
  researchSummary?: string | null;
  createdAt?: string | Date | null;
  approvedAt?: string | Date | null;
  assignedMemberId?: string | null;
  assignedMemberName?: string | null;
  marketName?: string | null;
}

interface CrmLeadSheetProps {
  initialLeads: CrmLeadItem[];
  nicheName?: string;
  nicheCategory?: string;
  customColumns?: CustomCrmColumn[];
  onOpenAddColumn?: () => void;
  onDeleteCustomColumn?: (key: string) => void;
  allMembers?: TeamMember[];
  canManageSettings?: boolean;
  isOwner?: boolean;
  embedded?: boolean;
  title?: string;
  subtitle?: string;
  showCallerLink?: boolean;
  dialerConfig?: DialerConfig;
  permissions?: TeamPermissions;
  activeActorName?: string;
  onLeadUpdated?: (updated: CrmLeadItem) => void;
  onLeadDeleted?: (companyId: string) => void;
}

export const CRM_STAGE_OPTIONS: Array<{
  value: LifecycleStatus;
  label: string;
  badgeClass: string;
}> = [
  {
    value: "APPROVED",
    label: "Ready to Call",
    badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  {
    value: "CALLING",
    label: "Calling / In Progress",
    badgeClass: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
  {
    value: "CONNECTED",
    label: "Connected / Spoke",
    badgeClass: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  },
  {
    value: "NURTURE",
    label: "Follow-Up / Nurture",
    badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  {
    value: "MEETING_BOOKED",
    label: "Meeting Booked",
    badgeClass: "bg-emerald-500/25 text-emerald-200 border-emerald-400/50",
  },
  {
    value: "QUALIFIED",
    label: "Qualified / Won",
    badgeClass: "bg-teal-500/20 text-teal-200 border-teal-400/40",
  },
  {
    value: "REJECTED",
    label: "Disqualified / Not Interested",
    badgeClass: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  },
];

export function formatFollowUpLabel(raw: string | null | undefined): {
  text: string;
  isOverdue: boolean;
} {
  if (!raw) return { text: "", isOverdue: false };
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    return { text: raw.replace("T", " "), isOverdue: false };
  }
  const isOverdue = d.getTime() < Date.now();
  const formatted = d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return { text: formatted, isOverdue };
}

export function buildPresetFollowUpIso(preset: "LATER_TODAY" | "TOMORROW" | "TWO_DAYS" | "NEXT_WEEK"): string {
  const now = new Date();
  const target = new Date(now);
  if (preset === "LATER_TODAY") {
    target.setHours(now.getHours() + 3, 0, 0, 0);
  } else if (preset === "TOMORROW") {
    target.setDate(now.getDate() + 1);
    target.setHours(10, 0, 0, 0);
  } else if (preset === "TWO_DAYS") {
    target.setDate(now.getDate() + 2);
    target.setHours(10, 0, 0, 0);
  } else if (preset === "NEXT_WEEK") {
    target.setDate(now.getDate() + 7);
    target.setHours(10, 0, 0, 0);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(
    target.getHours()
  )}:${pad(target.getMinutes())}`;
}

export function stripFollowUpTagFromNotes(notes: string | null | undefined): string {
  if (!notes) return "";
  return notes.replace(/\[Next Follow-up Scheduled:\s*[^\]]+\]\s*/gi, "").trim();
}

export function CrmLeadSheet({
  initialLeads,
  nicheName,
  nicheCategory,
  customColumns = [],
  onOpenAddColumn,
  onDeleteCustomColumn,
  allMembers = [],
  canManageSettings = false,
  isOwner = false,
  embedded = false,
  title = "Approved Leads",
  subtitle = "Click any status, qualification field, follow-up, or lead row to edit details inline.",
  showCallerLink = true,
  permissions,
  activeActorName = "Team Member",
  onLeadUpdated,
  onLeadDeleted,
}: CrmLeadSheetProps) {
  const [leads, setLeads] = useState<CrmLeadItem[]>(initialLeads);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [dateFilter, setDateFilter] = useState<"ALL" | "TODAY" | "YESTERDAY" | "OLDER">("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Inline Cell Editing State (Airtable / Google Sheets style)
  const [activeCellEdit, setActiveCellEdit] = useState<{
    leadId: string;
    field: "name" | "contactName" | "contactTitle" | "phone" | "notes";
  } | null>(null);
  const [activeCellDraft, setActiveCellDraft] = useState<string>("");
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);

  const startInlineEdit = (
    leadId: string,
    field: "name" | "contactName" | "contactTitle" | "phone" | "notes",
    currentVal: string
  ) => {
    setActiveCellEdit({ leadId, field });
    setActiveCellDraft(currentVal || "");
  };

  const commitInlineEdit = async (lead: CrmLeadItem) => {
    if (!activeCellEdit || activeCellEdit.leadId !== lead.id) return;
    const field = activeCellEdit.field;
    const value = activeCellDraft.trim();
    setActiveCellEdit(null);

    let hasChanged = false;
    const patch: Partial<CrmLeadItem> = {};
    const serverPayload: any = { companyId: lead.id };

    if (field === "name") {
      if (value && value !== lead.name) {
        hasChanged = true;
        patch.name = value;
        serverPayload.name = value;
      }
    } else if (field === "contactName") {
      const oldName = lead.bestContact?.name || "";
      if (value !== oldName) {
        hasChanged = true;
        patch.bestContact = {
          name: value || null,
          title: lead.bestContact?.title || null,
          phone: lead.bestContact?.phone || null,
          email: lead.bestContact?.email || null,
        };
        serverPayload.contactName = value || null;
      }
    } else if (field === "contactTitle") {
      const oldTitle = lead.bestContact?.title || "";
      if (value !== oldTitle) {
        hasChanged = true;
        patch.bestContact = {
          name: lead.bestContact?.name || null,
          title: value || null,
          phone: lead.bestContact?.phone || null,
          email: lead.bestContact?.email || null,
        };
        serverPayload.contactTitle = value || null;
      }
    } else if (field === "phone") {
      const oldPhone = lead.bestContact?.phone || lead.phoneDisplay || "";
      if (value !== oldPhone) {
        hasChanged = true;
        patch.phoneDisplay = value || null;
        patch.bestContact = {
          name: lead.bestContact?.name || null,
          title: lead.bestContact?.title || null,
          phone: value || null,
          email: lead.bestContact?.email || null,
        };
        serverPayload.phone = value || null;
        serverPayload.contactPhone = value || null;
      }
    } else if (field === "notes") {
      const oldNotes = stripFollowUpTagFromNotes(lead.notes) || "";
      if (value !== oldNotes) {
        hasChanged = true;
        const updatedNotes = lead.nextFollowUp
          ? value
            ? `[Next Follow-up Scheduled: ${lead.nextFollowUp}]\n${value}`
            : `[Next Follow-up Scheduled: ${lead.nextFollowUp}]`
          : value || null;
        patch.notes = updatedNotes;
        serverPayload.notes = value || null;
      }
    }

    if (!hasChanged) return;

    applyLeadPatch(lead.id, patch);
    setSavingCellKey(`${lead.id}:${field}`);

    const res = await updateLeadCrmDetailsAction(serverPayload);
    setSavingCellKey(null);
    if (res.ok) {
      setSyncFeedback(`Updated ${field} for ${lead.name}.`);
      setTimeout(() => setSyncFeedback(null), 2000);
    } else {
      setSyncFeedback(res.error || "Failed to update cell");
    }
  };

  const smartFields = getSmartFieldsForNiche(nicheCategory, nicheName, customColumns);

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
  const [actor] = useState(activeActorName);
  const [isPending, startTransition] = useTransition();
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Follow-Up Quick Scheduler Modal State
  const [followUpTarget, setFollowUpTarget] = useState<CrmLeadItem | null>(null);
  const [followUpInput, setFollowUpInput] = useState<string>("");
  const [followUpNote, setFollowUpNote] = useState<string>("");

  // Full Edit Lead Modal State
  const [editingLead, setEditingLead] = useState<CrmLeadItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editContactName, setEditContactName] = useState("");
  const [editContactTitle, setEditContactTitle] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editState, setEditState] = useState("");
  const [editStatus, setEditStatus] = useState<LifecycleStatus>("APPROVED");
  const [editFollowUp, setEditFollowUp] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editAssignedId, setEditAssignedId] = useState("");

  const canDiscover = isOwner || Boolean(permissions?.discoverLeads);
  const canImport = isOwner || Boolean(permissions?.discoverLeads || permissions?.exportAndSync);
  const canExport = isOwner || Boolean(permissions?.exportAndSync);
  const canCall = !permissions || permissions.callerWorkbench;
  const canEdit = !permissions || permissions.editContacts || permissions.callerWorkbench;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const applyLeadPatch = (id: string, patch: Partial<CrmLeadItem>) => {
    setLeads((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        onLeadUpdated?.(next);
        return next;
      })
    );
  };

  // Inline 1-click status change
  const handleInlineStatusChange = async (lead: CrmLeadItem, nextStatus: LifecycleStatus) => {
    applyLeadPatch(lead.id, { status: nextStatus });
    const res = await updateLeadStatusQuickAction({ companyId: lead.id, status: nextStatus });
    if (!res.ok) {
      setSyncFeedback(res.error || "Could not update status");
    } else {
      setSyncFeedback(`Updated ${lead.name} stage to ${nextStatus.replace(/_/g, " ")}.`);
      setTimeout(() => setSyncFeedback(null), 2500);
    }
  };

  // Inline 1-click smart field / custom column update
  const handleInlineSmartFieldChange = async (
    lead: CrmLeadItem,
    field: NicheSmartField,
    nextValue: string
  ) => {
    const nextFacts = { ...(lead.facts || {}), [field.key]: nextValue };
    applyLeadPatch(lead.id, { facts: nextFacts });
    const res = await updateLeadSmartFieldAction({
      companyId: lead.id,
      fieldKey: field.key,
      value: nextValue,
    });
    if (res.ok) {
      setSyncFeedback(`Updated ${field.shortLabel} for ${lead.name} to "${nextValue}".`);
      setTimeout(() => setSyncFeedback(null), 2500);
    }
  };

  // Inline 1-click caller assignment
  const handleInlineAssignCaller = async (lead: CrmLeadItem, memberId: string) => {
    const target = allMembers.find((m) => m.id === memberId);
    applyLeadPatch(lead.id, {
      assignedMemberId: memberId || null,
      assignedMemberName: target?.name || null,
    });
    const res = await assignLeadAction({
      companyId: lead.id,
      memberId: memberId || null,
      memberName: target?.name || null,
    });
    if (res.ok) {
      setSyncFeedback(
        target ? `Assigned ${lead.name} to ${target.name}.` : `Unassigned ${lead.name}.`
      );
      setTimeout(() => setSyncFeedback(null), 2500);
    }
  };

  // Open Quick Follow-Up Modal
  const openFollowUpModal = (lead: CrmLeadItem) => {
    setFollowUpTarget(lead);
    setFollowUpInput(lead.nextFollowUp || buildPresetFollowUpIso("TOMORROW"));
    setFollowUpNote("");
  };

  const handleSaveFollowUp = (customDate?: string | null) => {
    if (!followUpTarget) return;
    const dateToSave = customDate !== undefined ? customDate : followUpInput || null;
    const targetId = followUpTarget.id;
    const targetName = followUpTarget.name;

    applyLeadPatch(targetId, {
      nextFollowUp: dateToSave,
      status: dateToSave && followUpTarget.status === "APPROVED" ? "NURTURE" : followUpTarget.status,
    });
    setFollowUpTarget(null);

    startTransition(async () => {
      const res = await updateLeadFollowUpAction({
        companyId: targetId,
        followUpDate: dateToSave,
        note: followUpNote.trim() || null,
      });
      if (res.ok) {
        applyLeadPatch(targetId, {
          nextFollowUp: res.nextFollowUp,
          notes: res.updatedNotes,
        });
        setSyncFeedback(
          dateToSave
            ? `Scheduled follow-up for ${targetName}.`
            : `Cleared follow-up for ${targetName}.`
        );
        setTimeout(() => setSyncFeedback(null), 2500);
      }
    });
  };

  // Open Full Edit Modal
  const openEditModal = (lead: CrmLeadItem) => {
    setEditingLead(lead);
    setEditName(lead.name || "");
    setEditContactName(lead.bestContact?.name || "");
    setEditContactTitle(lead.bestContact?.title || "");
    setEditPhone(lead.bestContact?.phone || lead.phoneDisplay || "");
    setEditEmail(lead.bestContact?.email || "");
    setEditWebsite(lead.website || "");
    setEditCity(lead.city || "");
    setEditState(lead.state || "");
    setEditStatus((lead.status as LifecycleStatus) || "APPROVED");
    setEditFollowUp(lead.nextFollowUp || "");
    setEditNotes(stripFollowUpTagFromNotes(lead.notes));
    setEditAssignedId(lead.assignedMemberId || "");
  };

  const handleSaveEditLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLead) return;
    const targetId = editingLead.id;
    const assignedObj = allMembers.find((m) => m.id === editAssignedId);
    const nextAssignedId = editAssignedId ? editAssignedId : null;
    const nextAssignedName = assignedObj ? assignedObj.name : null;

    const updatedNotes = editFollowUp
      ? editNotes.trim()
        ? `[Next Follow-up Scheduled: ${editFollowUp}]\n${editNotes.trim()}`
        : `[Next Follow-up Scheduled: ${editFollowUp}]`
      : editNotes.trim() || null;

    const optimistic: Partial<CrmLeadItem> = {
      name: editName.trim() || editingLead.name,
      phoneDisplay: editPhone.trim() || null,
      website: editWebsite.trim() || null,
      city: editCity.trim() || null,
      state: editState.trim().toUpperCase() || null,
      status: editStatus,
      nextFollowUp: editFollowUp || null,
      notes: updatedNotes,
      assignedMemberId: nextAssignedId,
      assignedMemberName: nextAssignedName,
      bestContact: {
        name: editContactName.trim() || null,
        title: editContactTitle.trim() || null,
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
      },
    };

    applyLeadPatch(targetId, optimistic);
    setEditingLead(null);

    startTransition(async () => {
      const res = await updateLeadCrmDetailsAction({
        companyId: targetId,
        name: editName.trim(),
        phone: editPhone.trim() || null,
        website: editWebsite.trim() || null,
        city: editCity.trim() || null,
        state: editState.trim().toUpperCase() || null,
        status: editStatus,
        contactName: editContactName.trim() || null,
        contactTitle: editContactTitle.trim() || null,
        contactEmail: editEmail.trim() || null,
        contactPhone: editPhone.trim() || null,
        nextFollowUp: editFollowUp || null,
        notes: editNotes.trim() || null,
        assignedMemberId: nextAssignedId,
        assignedMemberName: nextAssignedName,
      });

      if (res.ok) {
        setSyncFeedback(`Saved changes for ${editName.trim()}.`);
        setTimeout(() => setSyncFeedback(null), 2500);
      } else {
        setSyncFeedback(res.error || "Failed to save changes");
      }
    });
  };

  const handleDeleteLead = (companyId: string, name: string) => {
    setLeads((prev) => prev.filter((l) => l.id !== companyId));
    onLeadDeleted?.(companyId);
    setEditingLead(null);
    startTransition(async () => {
      await deleteCrmLeadAction({ companyId });
      setSyncFeedback(`Removed ${name} from active CRM.`);
      setTimeout(() => setSyncFeedback(null), 2500);
    });
  };

  // Filter leads
  const filteredLeads = leads.filter((lead) => {
    if (lead.status === "REJECTED" && statusFilter !== "REJECTED") return false;
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

    if (dateFilter !== "ALL") {
      const dateInfo = classifyLeadDate(lead);
      if (dateFilter === "TODAY" && dateInfo.category !== "TODAY") return false;
      if (dateFilter === "YESTERDAY" && dateInfo.category !== "YESTERDAY") return false;
      if (dateFilter === "OLDER" && (dateInfo.category === "TODAY" || dateInfo.category === "YESTERDAY"))
        return false;
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
        const cleanExisting = stripFollowUpTagFromNotes(selectedLead.notes);
        const updatedNotes = cleanExisting
          ? `${cleanExisting}\n[Call ${new Date().toISOString().slice(0, 10)}] ${combinedNotes}`
          : `[Call ${new Date().toISOString().slice(0, 10)}] ${combinedNotes}`;

        applyLeadPatch(selectedLead.id, {
          status: res.nextStatus!,
          nextFollowUp: followUpDate || selectedLead.nextFollowUp,
          notes: updatedNotes,
        });
        setSelectedLead(null);
      } else {
        alert(res.error || "Could not save call");
      }
    });
  };

  // Filter counters
  const activeLeads = leads.filter((l) => l.status !== "REJECTED");
  const totalCount = activeLeads.length;
  const toCallCount = activeLeads.filter((l) =>
    ["APPROVED", "SYNCED", "CALLING"].includes(l.status)
  ).length;
  const connectedCount = activeLeads.filter((l) =>
    ["CONNECTED", "PAIN_FOUND"].includes(l.status)
  ).length;
  const meetingsCount = activeLeads.filter((l) => l.status === "MEETING_BOOKED").length;
  const followUpCount = activeLeads.filter(
    (l) => l.nextFollowUp || (l.notes && l.notes.includes("Follow-up Scheduled"))
  ).length;

  const { todayCount, yesterdayCount, olderCount } = React.useMemo(() => {
    let today = 0;
    let yesterday = 0;
    let older = 0;
    for (const lead of activeLeads) {
      const info = classifyLeadDate(lead);
      if (info.category === "TODAY") today++;
      else if (info.category === "YESTERDAY") yesterday++;
      else older++;
    }
    return { todayCount: today, yesterdayCount: yesterday, olderCount: older };
  }, [activeLeads]);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-[#121215]">
      {/* Top Header Bar (Only shown when standalone, hidden when embedded in /caller) */}
      {!embedded && (
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
            {canEdit && onOpenAddColumn && (
              <button
                type="button"
                onClick={onOpenAddColumn}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Custom Column</span>
              </button>
            )}

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
                <span>Open Leads CRM</span>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Feedback Alert */}
      {syncFeedback && (
        <div className="flex items-center justify-between border-b border-zinc-800 bg-[#09090b] px-5 py-2.5 text-xs text-zinc-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{syncFeedback}</span>
          </div>
          <button onClick={() => setSyncFeedback(null)} className="text-zinc-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
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

      {/* Date Batch Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 bg-[#0c0c0f] px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-zinc-400 mr-1 flex items-center gap-1">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span>Intake Day:</span>
          </span>
          {[
            { key: "ALL", label: `All Batches (${totalCount})` },
            {
              key: "TODAY",
              label: `Today's Intake (${todayCount})`,
              activeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
            },
            {
              key: "YESTERDAY",
              label: `Yesterday (${yesterdayCount})`,
              activeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40",
            },
            {
              key: "OLDER",
              label: `Earlier Batches (${olderCount})`,
              activeClass: "bg-zinc-700/40 text-zinc-200 border-zinc-600",
            },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setDateFilter(tab.key as any)}
              className={`rounded-md border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                dateFilter === tab.key
                  ? tab.activeClass || "border-zinc-500 bg-zinc-800 text-white"
                  : "border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {dateFilter !== "ALL" && (
          <button
            type="button"
            onClick={() => setDateFilter("ALL")}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 underline"
          >
            Clear date filter
          </button>
        )}
      </div>

      {/* Spreadsheet Table View */}
      {filteredLeads.length === 0 ? (
        <div className="p-10 text-center text-xs text-zinc-400 space-y-3">
          <Sheet className="w-7 h-7 text-zinc-600 mx-auto" />
          <p className="font-semibold text-sm text-zinc-200">
            No leads found for {nicheName ? `"${nicheName}"` : "this filter"}
          </p>
          <p className="max-w-md mx-auto text-zinc-400">
            {canDiscover
              ? "Switch filter tabs above or extract new verified leads."
              : "No leads are currently assigned to your queue. Contact your workspace owner to assign leads."}
          </p>
          {(canDiscover || canImport) && (
            <div className="flex items-center justify-center gap-2.5 pt-1">
              {canDiscover && (
                <Link
                  href="/discover"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-1.5 text-xs font-bold text-black hover:bg-zinc-200"
                >
                  <span>+ Find Leads</span>
                </Link>
              )}
              {canImport && (
                <button
                  type="button"
                  onClick={() => setImportModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import CSV</span>
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300 divide-y divide-zinc-800/70">
            <thead className="bg-[#09090b] text-[11px] font-medium text-zinc-400">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">Company &amp; Location</th>
                <th className="px-3 py-3 whitespace-nowrap">Decision Maker</th>
                <th className="px-3 py-3 whitespace-nowrap">Direct Phone</th>
                <th className="px-3 py-3 whitespace-nowrap">Assigned Caller</th>
                <th className="px-3 py-3 whitespace-nowrap">Pipeline Stage</th>
                {smartFields.map((field) => (
                  <th key={field.key} className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span>{field.label}</span>
                      {field.isCustom && onDeleteCustomColumn && (
                        <button
                          type="button"
                          onClick={() => onDeleteCustomColumn(field.key)}
                          className="text-zinc-500 hover:text-rose-400 transition"
                          title={`Remove custom column "${field.label}"`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-3 py-3 whitespace-nowrap">Next Follow-Up</th>
                <th className="px-3 py-3 whitespace-nowrap">Latest Note</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="flex items-center justify-end gap-2">
                    {canEdit && onOpenAddColumn && (
                      <button
                        type="button"
                        onClick={onOpenAddColumn}
                        className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 transition"
                        title="Add a custom column to this CRM table"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        <span>Column</span>
                      </button>
                    )}
                    <span>Actions</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filteredLeads.map((lead, idx) => {
                const phone = lead.bestContact?.phone || lead.phoneDisplay;
                const dmName = lead.bestContact?.name;
                const dmTitle = lead.bestContact?.title;
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${lead.name} ${lead.address || ""} ${lead.city || ""} ${lead.state || ""}`
                )}`;
                const followUpInfo = formatFollowUpLabel(lead.nextFollowUp);
                const cleanNotes = stripFollowUpTagFromNotes(lead.notes);
                const dateInfo = classifyLeadDate(lead);
                const prevLead = idx > 0 ? filteredLeads[idx - 1] : null;
                const isNewBatch = !prevLead || classifyLeadDate(prevLead).groupKey !== dateInfo.groupKey;

                return (
                  <React.Fragment key={lead.id}>
                    {isNewBatch && (
                      <tr className="bg-zinc-950 border-y border-zinc-800/80 sticky top-0 z-10">
                        <td colSpan={8 + smartFields.length} className="px-4 py-2">
                          <div className="flex items-center justify-between text-xs font-bold">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-block w-2 h-2 rounded-full ${
                                  dateInfo.category === "TODAY"
                                    ? "bg-emerald-400"
                                    : dateInfo.category === "YESTERDAY"
                                    ? "bg-amber-400"
                                    : "bg-zinc-500"
                                }`}
                              />
                              <span
                                className={
                                  dateInfo.category === "TODAY"
                                    ? "text-emerald-300 font-bold"
                                    : dateInfo.category === "YESTERDAY"
                                    ? "text-amber-300 font-bold"
                                    : "text-zinc-300 font-semibold"
                                }
                              >
                                {dateInfo.title}
                              </span>
                              <span className="text-[10px] text-zinc-500 font-normal">
                                ({dateInfo.formattedDate})
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr className="hover:bg-zinc-900/60 transition-colors">
                      {/* Company & Location */}
                      <td className="px-4 py-3.5 max-w-[220px]">
                        {activeCellEdit?.leadId === lead.id && activeCellEdit.field === "name" ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              type="text"
                              value={activeCellDraft}
                              onChange={(e) => setActiveCellDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitInlineEdit(lead);
                                } else if (e.key === "Escape") {
                                  setActiveCellEdit(null);
                                }
                              }}
                              onBlur={() => commitInlineEdit(lead)}
                              className="w-full bg-[#09090b] border border-emerald-500 rounded px-2 py-1 text-xs text-white focus:outline-none shadow-sm"
                            />
                          </div>
                        ) : (
                          <div className="font-semibold text-white text-xs truncate flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => canEdit && startInlineEdit(lead.id, "name", lead.name)}
                              className="group/name flex items-center gap-1 text-left truncate hover:text-emerald-300 transition"
                              title="Click to edit company name inline"
                            >
                              <span className="truncate">{lead.name}</span>
                              {canEdit && (
                                <Pencil className="w-2.5 h-2.5 text-zinc-500 opacity-0 group-hover/name:opacity-100 transition shrink-0" />
                              )}
                            </button>
                            {lead.marketName && (
                              <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-zinc-300">
                                {lead.marketName}
                              </span>
                            )}
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold border ${
                                dateInfo.category === "TODAY"
                                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                                  : dateInfo.category === "YESTERDAY"
                                  ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
                                  : "border-zinc-800 bg-zinc-900 text-zinc-400"
                              }`}
                              title={`Intake: ${dateInfo.formattedDate} at ${dateInfo.timeString}`}
                            >
                              {dateInfo.shortBadge}
                            </span>
                          </div>
                        )}
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
                        {activeCellEdit?.leadId === lead.id && activeCellEdit.field === "contactName" ? (
                          <input
                            autoFocus
                            type="text"
                            value={activeCellDraft}
                            onChange={(e) => setActiveCellDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitInlineEdit(lead);
                              } else if (e.key === "Escape") {
                                setActiveCellEdit(null);
                              }
                            }}
                            onBlur={() => commitInlineEdit(lead)}
                            className="w-full bg-[#09090b] border border-emerald-500 rounded px-2 py-0.5 text-xs text-white focus:outline-none shadow-sm mb-1"
                            placeholder="Contact Name"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => canEdit && startInlineEdit(lead.id, "contactName", dmName || "")}
                            className="text-left group/dm w-full flex items-center justify-between"
                            title="Click to edit contact person inline"
                          >
                            <div className="font-medium text-zinc-200 text-xs truncate group-hover/dm:text-emerald-300 flex items-center gap-1">
                              <span>{dmName || "Owner / Manager"}</span>
                              {canEdit && (
                                <Pencil className="w-2.5 h-2.5 text-zinc-500 opacity-0 group-hover/dm:opacity-100 transition" />
                              )}
                            </div>
                          </button>
                        )}

                        {activeCellEdit?.leadId === lead.id && activeCellEdit.field === "contactTitle" ? (
                          <input
                            autoFocus
                            type="text"
                            value={activeCellDraft}
                            onChange={(e) => setActiveCellDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitInlineEdit(lead);
                              } else if (e.key === "Escape") {
                                setActiveCellEdit(null);
                              }
                            }}
                            onBlur={() => commitInlineEdit(lead)}
                            className="w-full bg-[#09090b] border border-emerald-500 rounded px-2 py-0.5 text-[11px] text-zinc-200 focus:outline-none shadow-sm mt-0.5"
                            placeholder="Role / Title"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => canEdit && startInlineEdit(lead.id, "contactTitle", dmTitle || "")}
                            className="text-left group/title w-full flex items-center gap-1 text-[11px] text-zinc-400 truncate hover:text-zinc-200"
                            title="Click to edit role/title inline"
                          >
                            <span className="truncate">{dmTitle || "Decision Maker"}</span>
                            {canEdit && (
                              <Pencil className="w-2 h-2 text-zinc-500 opacity-0 group-hover/title:opacity-100 transition" />
                            )}
                          </button>
                        )}
                      </td>

                      {/* Phone */}
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        {activeCellEdit?.leadId === lead.id && activeCellEdit.field === "phone" ? (
                          <input
                            autoFocus
                            type="text"
                            value={activeCellDraft}
                            onChange={(e) => setActiveCellDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitInlineEdit(lead);
                              } else if (e.key === "Escape") {
                                setActiveCellEdit(null);
                              }
                            }}
                            onBlur={() => commitInlineEdit(lead)}
                            className="w-36 bg-[#09090b] border border-emerald-500 rounded px-2 py-1 font-mono text-xs text-emerald-400 focus:outline-none shadow-sm"
                            placeholder="(555) 000-0000"
                          />
                        ) : phone ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => copyToClipboard(phone, lead.id)}
                              className="group inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#09090b] hover:bg-zinc-800 border border-zinc-800/80 hover:border-emerald-500/30 transition text-left cursor-pointer"
                              title="Click to copy phone number"
                            >
                              <span className="font-mono font-bold text-xs text-emerald-400 group-hover:text-emerald-300">
                                {phone}
                              </span>
                              {copiedId === lead.id ? (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 font-sans font-bold">
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span>Copied</span>
                                </span>
                              ) : (
                                <Copy className="w-3 h-3 text-zinc-500 group-hover:text-emerald-400 transition" />
                              )}
                            </button>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => startInlineEdit(lead.id, "phone", phone)}
                                className="p-1 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition"
                                title="Edit phone number inline"
                              >
                                <Pencil className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => canEdit && startInlineEdit(lead.id, "phone", "")}
                            className="text-zinc-500 hover:text-emerald-400 text-[11px] underline flex items-center gap-1"
                          >
                            <Plus className="w-2.5 h-2.5" />
                            <span>Add phone</span>
                          </button>
                        )}
                      </td>

                      {/* Assigned Caller */}
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        {canManageSettings && allMembers.length > 0 ? (
                          <select
                            value={lead.assignedMemberId || ""}
                            onChange={(e) => handleInlineAssignCaller(lead, e.target.value)}
                            className="rounded-lg border border-zinc-800 bg-[#09090b] px-2 py-1 text-[11px] font-medium text-zinc-200 focus:border-zinc-500 focus:outline-none cursor-pointer"
                          >
                            <option value="">Unassigned</option>
                            {allMembers
                              .filter((m) => m.status === "ACTIVE" && m.role !== "VIEWER")
                              .map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-[#09090b] px-2 py-1 text-[11px] font-medium text-zinc-300">
                            {lead.assignedMemberName || "Unassigned"}
                          </span>
                        )}
                      </td>

                      {/* Interactive Status Dropdown with Vivid Stage Badges */}
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        {canEdit ? (
                          <select
                            value={lead.status}
                            onChange={(e) =>
                              handleInlineStatusChange(lead, e.target.value as LifecycleStatus)
                            }
                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold focus:outline-none cursor-pointer transition ${
                              CRM_STAGE_OPTIONS.find((s) => s.value === lead.status)?.badgeClass ||
                              "border-zinc-700 bg-[#09090b] text-zinc-100"
                            }`}
                          >
                            {CRM_STAGE_OPTIONS.map((st) => (
                              <option key={st.value} value={st.value} className="bg-[#121215] text-zinc-200">
                                {st.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-zinc-300">{lead.status}</span>
                        )}
                      </td>

                      {/* Niche-Specific Smart Qualification Fields + Custom Columns */}
                      {smartFields.map((field) => {
                        const val = resolveSmartFieldValue(lead, field);
                        const isPositive =
                          val.includes("✓") ||
                          (val !== "Ask on Call" && val !== "Verify on Call");
                        const allOpts = field.options.includes(val)
                          ? field.options
                          : [val, ...field.options];

                        return (
                          <td key={field.key} className="px-3 py-3.5 whitespace-nowrap">
                            {canEdit ? (
                              <select
                                value={val}
                                onChange={(e) =>
                                  handleInlineSmartFieldChange(lead, field, e.target.value)
                                }
                                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold focus:outline-none cursor-pointer transition ${
                                  isPositive
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                    : "border-zinc-800 bg-[#09090b] text-zinc-300 hover:border-zinc-700"
                                }`}
                              >
                                {allOpts.map((opt) => (
                                  <option key={opt} value={opt} className="bg-[#121215] text-white">
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-[11px] text-zinc-300">{val}</span>
                            )}
                          </td>
                        );
                      })}

                      {/* Interactive Follow-Up Column */}
                      <td className="px-3 py-3.5 whitespace-nowrap">
                        {lead.nextFollowUp ? (
                          <button
                            type="button"
                            onClick={() => canEdit && openFollowUpModal(lead)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                              followUpInfo.isOverdue
                                ? "border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                            }`}
                            title="Click to reschedule or mark follow-up done"
                          >
                            <Calendar className="w-3 h-3 shrink-0" />
                            <span>{followUpInfo.text}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => canEdit && openFollowUpModal(lead)}
                            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800 hover:border-zinc-600 px-2.5 py-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-200 transition"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Set Follow-Up</span>
                          </button>
                        )}
                      </td>

                      {/* Clickable Inline Notes */}
                      <td className="px-3 py-3.5 max-w-[240px]">
                        {activeCellEdit?.leadId === lead.id && activeCellEdit.field === "notes" ? (
                          <textarea
                            autoFocus
                            rows={2}
                            value={activeCellDraft}
                            onChange={(e) => setActiveCellDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                commitInlineEdit(lead);
                              } else if (e.key === "Escape") {
                                setActiveCellEdit(null);
                              }
                            }}
                            onBlur={() => commitInlineEdit(lead)}
                            className="w-full bg-[#09090b] border border-emerald-500 rounded p-1.5 text-xs text-zinc-200 focus:outline-none shadow-sm"
                            placeholder="Type note and hit Enter to save..."
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => canEdit && startInlineEdit(lead.id, "notes", cleanNotes || "")}
                            className="text-left w-full group/notes cursor-pointer"
                            title="Click to edit notes inline (Enter to save)"
                          >
                            {cleanNotes ? (
                              <div className="flex items-start gap-1">
                                <p className="text-[11px] text-zinc-300 truncate group-hover/notes:text-white flex-1">
                                  {cleanNotes.split("\n")[0] || cleanNotes}
                                </p>
                                {canEdit && (
                                  <Pencil className="w-2.5 h-2.5 text-zinc-500 opacity-0 group-hover/notes:opacity-100 transition shrink-0 mt-0.5" />
                                )}
                              </div>
                            ) : (
                              <span className="text-zinc-500 group-hover/notes:text-emerald-400 text-[11px] underline decoration-dotted flex items-center gap-1">
                                <Plus className="w-2.5 h-2.5" />
                                <span>Add note</span>
                              </span>
                            )}
                          </button>
                        )}
                      </td>

                      {/* Quick Actions */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {canCall && (
                            <button
                              type="button"
                              onClick={() => openCallModal(lead)}
                              className="inline-flex items-center gap-1 rounded-lg bg-white hover:bg-zinc-200 px-3 py-1.5 text-xs font-bold text-black transition shadow-sm"
                            >
                              <span>Log Call</span>
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => openEditModal(lead)}
                              className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
                              title="Edit Lead & Contact Details"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick Follow-Up Scheduler Modal */}
      {followUpTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>Schedule Follow-Up: {followUpTarget.name}</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Pick a quick preset or choose an exact date and time.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFollowUpTarget(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                  1-Click Quick Schedule
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Later Today (+3h)", preset: "LATER_TODAY" as const },
                    { label: "Tomorrow 10:00 AM", preset: "TOMORROW" as const },
                    { label: "In 2 Days (10 AM)", preset: "TWO_DAYS" as const },
                    { label: "Next Week (10 AM)", preset: "NEXT_WEEK" as const },
                  ].map((item) => (
                    <button
                      key={item.preset}
                      type="button"
                      onClick={() => setFollowUpInput(buildPresetFollowUpIso(item.preset))}
                      className="rounded-lg border border-zinc-800 bg-[#09090b] hover:border-amber-500/40 hover:bg-amber-500/10 px-3 py-2 text-xs font-semibold text-zinc-200 hover:text-amber-200 text-left transition"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Exact Date &amp; Time
                </label>
                <input
                  type="datetime-local"
                  value={followUpInput}
                  onChange={(e) => setFollowUpInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:outline-none focus:border-zinc-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Follow-Up Reminder Note (Optional)
                </label>
                <input
                  type="text"
                  value={followUpNote}
                  onChange={(e) => setFollowUpNote(e.target.value)}
                  placeholder="e.g. Call back after 2 PM to speak with owner..."
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                />
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
                {followUpTarget.nextFollowUp ? (
                  <button
                    type="button"
                    onClick={() => handleSaveFollowUp(null)}
                    className="px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-semibold text-zinc-300 hover:text-white transition inline-flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Mark Done / Clear</span>
                  </button>
                ) : (
                  <div />
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFollowUpTarget(null)}
                    className="px-3 py-2 rounded-lg text-zinc-400 hover:text-white text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveFollowUp()}
                    className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-bold text-xs transition"
                  >
                    Save Follow-Up
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Edit Lead & Contact Modal */}
      {editingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-xl bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Edit CRM Lead: {editingLead.name}</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Update company info, decision maker, phone, stage, follow-up, or notes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingLead(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditLead} className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Company Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Pipeline Stage
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as LifecycleStatus)}
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  >
                    {CRM_STAGE_OPTIONS.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Decision Maker / Contact Name
                  </label>
                  <input
                    type="text"
                    value={editContactName}
                    onChange={(e) => setEditContactName(e.target.value)}
                    placeholder="e.g. Michael Carter"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Job Title / Role
                  </label>
                  <input
                    type="text"
                    value={editContactTitle}
                    onChange={(e) => setEditContactTitle(e.target.value)}
                    placeholder="e.g. Owner, Managing Broker"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Direct Phone Number
                  </label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="(555) 234-5678"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="owner@company.com"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Website</label>
                  <input
                    type="text"
                    value={editWebsite}
                    onChange={(e) => setEditWebsite(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">City</label>
                  <input
                    type="text"
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    placeholder="Dallas"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">State</label>
                  <input
                    type="text"
                    value={editState}
                    onChange={(e) => setEditState(e.target.value)}
                    placeholder="TX"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Next Follow-Up Date &amp; Time
                  </label>
                  {editFollowUp && (
                    <button
                      type="button"
                      onClick={() => setEditFollowUp("")}
                      className="text-[11px] text-amber-400 hover:underline"
                    >
                      Clear Follow-Up
                    </button>
                  )}
                </div>
                <input
                  type="datetime-local"
                  value={editFollowUp}
                  onChange={(e) => setEditFollowUp(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                />
              </div>

              {canManageSettings && allMembers && allMembers.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Assigned Caller
                  </label>
                  <select
                    value={editAssignedId}
                    onChange={(e) => setEditAssignedId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none cursor-pointer"
                  >
                    <option value="">Unassigned</option>
                    {allMembers
                      .filter((m) => m.status === "ACTIVE" && m.role !== "VIEWER")
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.role})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  CRM Notes &amp; Call History
                </label>
                <textarea
                  rows={4}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add notes about this company, decision maker preferences, pricing, or call history..."
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
                {(isOwner || canManageSettings) ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteLead(editingLead.id, editingLead.name)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-semibold transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove from CRM</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingLead(null)}
                    className="px-4 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black font-bold text-xs transition"
                  >
                    {isPending ? "Saving..." : "Save Lead Changes"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Call & Outcome Modal */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Log Call: {selectedLead.name}</h3>
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
                    { key: "MEETING_BOOKED", label: "Meeting Booked" },
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
