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
import {
  classifyLeadDate,
  parseLatestCallerNote,
  getLeadIntakeDate,
} from "@/components/crm-date-utils";
import { updateTeamMemberAccessAction } from "@/app/settings/actions";
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
  Shield,
  ShieldCheck,
  ArrowUpDown,
  Filter,
  Users,
  HelpCircle,
  TrendingUp,
  BookOpen,
  Lightbulb,
  Target,
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
    linkedinUrl?: string | null;
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
  const [callerFilter, setCallerFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"INTAKE_DATE" | "ICP_SCORE" | "NAME_AZ" | "STAGE">("INTAKE_DATE");
  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);
  const [viewingNotesHistoryLead, setViewingNotesHistoryLead] = useState<CrmLeadItem | null>(null);
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

    if (field !== "notes" && !canEdit) {
      setSyncFeedback("Permission restricted: Only owners/managers can edit contact fields.");
      setTimeout(() => setSyncFeedback(null), 3000);
      return;
    }
    if (field === "notes" && !canEditNotes) {
      setSyncFeedback("Permission restricted: You do not have permission to edit notes.");
      setTimeout(() => setSyncFeedback(null), 3000);
      return;
    }

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

  // SOP & Guidance Modal State
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [helpTab, setHelpTab] = useState<"CRM" | "CALLING" | "GATEKEEPER" | "OBJECTIONS">("CRM");

  // Full Edit Lead Modal State
  const [editingLead, setEditingLead] = useState<CrmLeadItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editContactName, setEditContactName] = useState("");
  const [editContactTitle, setEditContactTitle] = useState("");
  const [editContactLinkedin, setEditContactLinkedin] = useState("");
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
  const canCall = isOwner || !permissions || Boolean(permissions.callerWorkbench);
  const canEdit = isOwner || Boolean(permissions?.editContacts);
  const canEditNotes =
    isOwner || Boolean(permissions?.editContacts) || Boolean(permissions?.callerWorkbench);

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
    if (nextStatus === "CONNECTED" || nextStatus === "MEETING_BOOKED" || nextStatus === "PAIN_FOUND") {
      setSelectedLead(lead);
      setOutcome(nextStatus === "MEETING_BOOKED" ? "MEETING_BOOKED" : "CONNECTED");
      setNotes("");
      setFollowUpDate(lead.nextFollowUp || "");
      return;
    }

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
    setEditContactLinkedin(lead.bestContact?.linkedinUrl || (lead.facts as any)?.["linkedin"] || "");
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
        linkedinUrl: editContactLinkedin.trim() || null,
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
        contactLinkedin: editContactLinkedin.trim() || null,
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
    if (callerFilter === "UNASSIGNED" && lead.assignedMemberId && lead.assignedMemberId !== "") return false;
    if (
      callerFilter !== "ALL" &&
      callerFilter !== "UNASSIGNED" &&
      lead.assignedMemberId !== callerFilter
    ) {
      return false;
    }

    if (statusFilter === "TO_CALL") {
      if (!["APPROVED", "SYNCED", "CALLING"].includes(lead.status)) return false;
      const parsed = parseLatestCallerNote(lead.notes);
      const outcome = (parsed?.outcome || "").toLowerCase();
      if (outcome.includes("meeting") || outcome.includes("connected") || outcome.includes("spoke")) return false;
    } else if (statusFilter === "CONNECTED") {
      const parsed = parseLatestCallerNote(lead.notes);
      const outcome = (parsed?.outcome || "").toLowerCase();
      if (!["CONNECTED", "PAIN_FOUND"].includes(lead.status) && !outcome.includes("connected") && !outcome.includes("spoke"))
        return false;
    } else if (statusFilter === "MEETINGS") {
      const parsed = parseLatestCallerNote(lead.notes);
      const outcome = (parsed?.outcome || "").toLowerCase();
      if (lead.status !== "MEETING_BOOKED" && !outcome.includes("meeting")) return false;
    } else if (statusFilter === "FOLLOW_UP") {
      if (!lead.nextFollowUp && !(lead.notes && lead.notes.includes("Follow-up Scheduled")))
        return false;
    } else if (statusFilter === "NO_ANSWER") {
      const parsed = parseLatestCallerNote(lead.notes);
      const outcome = (parsed?.outcome || "").toLowerCase();
      if (!outcome.includes("no answer")) return false;
    } else if (statusFilter === "GATEKEEPER") {
      const parsed = parseLatestCallerNote(lead.notes);
      const outcome = (parsed?.outcome || "").toLowerCase();
      if (!outcome.includes("gatekeeper")) return false;
    } else if (statusFilter === "VOICEMAIL") {
      const parsed = parseLatestCallerNote(lead.notes);
      const outcome = (parsed?.outcome || "").toLowerCase();
      if (!outcome.includes("voicemail")) return false;
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

  // Deterministic stable sorting so leads NEVER jump around unexpectedly
  const sortedLeads = React.useMemo(() => {
    const list = [...filteredLeads];
    if (sortBy === "INTAKE_DATE") {
      list.sort((a, b) => {
        const aTime = getLeadIntakeDate(a).getTime();
        const bTime = getLeadIntakeDate(b).getTime();
        if (bTime !== aTime) return bTime - aTime;
        return (b.icpScore || 0) - (a.icpScore || 0);
      });
    } else if (sortBy === "ICP_SCORE") {
      list.sort((a, b) => (b.icpScore || 0) - (a.icpScore || 0));
    } else if (sortBy === "NAME_AZ") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "STAGE") {
      list.sort((a, b) => a.status.localeCompare(b.status));
    }
    return list;
  }, [filteredLeads, sortBy]);

  const teamCallers = React.useMemo(() => {
    return (allMembers || []).filter(
      (m) => m.status === "ACTIVE" && m.role !== "VIEWER"
    );
  }, [allMembers]);

  const callerStats = React.useMemo(() => {
    const map: Record<
      string,
      {
        total: number;
        callsLogged: number;
        connected: number;
        meetings: number;
        followUps: number;
        noAnswer: number;
        gatekeeper: number;
        voicemail: number;
      }
    > = {};
    for (const c of teamCallers) {
      map[c.id] = {
        total: 0,
        callsLogged: 0,
        connected: 0,
        meetings: 0,
        followUps: 0,
        noAnswer: 0,
        gatekeeper: 0,
        voicemail: 0,
      };
    }
    let unassigned = 0;
    const teamTotals = {
      callsLogged: 0,
      connected: 0,
      meetings: 0,
      followUps: 0,
      noAnswer: 0,
      gatekeeper: 0,
      voicemail: 0,
    };

    for (const lead of leads) {
      if (lead.status === "REJECTED") continue;
      if (!lead.assignedMemberId) {
        unassigned++;
      }
      const assignedEntry = lead.assignedMemberId ? map[lead.assignedMemberId] : null;
      if (assignedEntry) {
        assignedEntry.total++;
        if (lead.nextFollowUp) assignedEntry.followUps++;
      }

      // Parse individual call log lines from lead.notes
      if (lead.notes) {
        const lines = lead.notes.split("\n");
        for (const line of lines) {
          const match = line.match(/^\[([^•\]]+)(?:•\s*([^(]+))?(?:\(([^)]+)\))?\]:/);
          if (match) {
            const author = (match[2] || "").trim().toLowerCase();
            const outcome = (match[3] || "").trim().toLowerCase();

            const targetCaller = teamCallers.find(
              (c) =>
                c.name.toLowerCase() === author ||
                c.email.toLowerCase() === author ||
                (lead.assignedMemberId === c.id && !author)
            );
            const entry = targetCaller ? map[targetCaller.id] : assignedEntry;

            if (entry) {
              entry.callsLogged++;
              if (outcome.includes("connected") || outcome.includes("spoke")) entry.connected++;
              else if (outcome.includes("meeting")) entry.meetings++;
              else if (outcome.includes("no answer")) entry.noAnswer++;
              else if (outcome.includes("gatekeeper")) entry.gatekeeper++;
              else if (outcome.includes("voicemail")) entry.voicemail++;
            }

            teamTotals.callsLogged++;
            if (outcome.includes("connected") || outcome.includes("spoke")) teamTotals.connected++;
            else if (outcome.includes("meeting")) teamTotals.meetings++;
            else if (outcome.includes("no answer")) teamTotals.noAnswer++;
            else if (outcome.includes("gatekeeper")) teamTotals.gatekeeper++;
            else if (outcome.includes("voicemail")) teamTotals.voicemail++;
          }
        }
      }
    }
    return { callerMap: map, unassignedCount: unassigned, teamTotals };
  }, [leads, teamCallers]);

  const openCallModal = (lead: CrmLeadItem) => {
    setSelectedLead(lead);
    setOutcome("CONNECTED");
    setNotes("");
    setFollowUpDate(lead.nextFollowUp || "");
  };

  const handleSaveCall = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead) return;

    startTransition(async () => {
      const combinedNotes = followUpDate
        ? `[Next Follow-up Scheduled: ${followUpDate}] ${notes.trim()}`
        : notes.trim();

      const res = await logCallFeedbackAction({
        companyId: selectedLead.id,
        actor: actor.trim() || activeActorName,
        callOutcome: outcome,
        callerNotes: combinedNotes,
        followUpDate: followUpDate || null,
      });

      if (res.success && res.nextStatus) {
        applyLeadPatch(selectedLead.id, {
          status: res.nextStatus,
          nextFollowUp: res.nextFollowUp || followUpDate || selectedLead.nextFollowUp,
          notes: res.updatedNotes || selectedLead.notes,
        });
        setSyncFeedback(`Call logged successfully for ${selectedLead.name}.`);
        setTimeout(() => setSyncFeedback(null), 3000);
        setSelectedLead(null);
      } else {
        alert(res.error || "Could not save call");
      }
    });
  };

  // Filter counters
  const activeLeads = leads.filter((l) => l.status !== "REJECTED");
  const totalCount = activeLeads.length;

  const {
    toCallCount,
    connectedCount,
    meetingsCount,
    followUpCount,
    noAnswerCount,
    gatekeeperCount,
    voicemailCount,
  } = React.useMemo(() => {
    let toCall = 0;
    let connected = 0;
    let meetings = 0;
    let followUp = 0;
    let noAnswer = 0;
    let gatekeeper = 0;
    let voicemail = 0;

    for (const lead of activeLeads) {
      const parsed = parseLatestCallerNote(lead.notes);
      const outcome = (parsed?.outcome || "").toLowerCase();
      const hasFollowUp = Boolean(
        lead.nextFollowUp || (lead.notes && lead.notes.includes("Follow-up Scheduled"))
      );

      if (hasFollowUp) followUp++;

      if (lead.status === "MEETING_BOOKED" || outcome.includes("meeting")) {
        meetings++;
      } else if (
        ["CONNECTED", "PAIN_FOUND"].includes(lead.status) ||
        outcome.includes("connected") ||
        outcome.includes("spoke")
      ) {
        connected++;
      } else if (outcome.includes("no answer")) {
        noAnswer++;
      } else if (outcome.includes("gatekeeper")) {
        gatekeeper++;
      } else if (outcome.includes("voicemail")) {
        voicemail++;
      } else if (["APPROVED", "SYNCED", "CALLING"].includes(lead.status)) {
        toCall++;
      }
    }

    return {
      toCallCount: toCall,
      connectedCount: connected,
      meetingsCount: meetings,
      followUpCount: followUp,
      noAnswerCount: noAnswer,
      gatekeeperCount: gatekeeper,
      voicemailCount: voicemail,
    };
  }, [activeLeads]);

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

            {isOwner && teamCallers.length > 0 && (
              <button
                type="button"
                onClick={() => setIsPermissionsModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-300 transition"
                title="Manage caller permissions and CRM table access"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Caller Controls</span>
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

            {isOwner && (
              <Link
                href="/analytics"
                className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20 px-3 py-1.5 text-xs font-semibold text-purple-300 transition"
                title="View Sales Funnel, conversion analytics, and team diagnostics"
              >
                <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
                <span>Sales Funnel</span>
              </Link>
            )}

            <button
              type="button"
              onClick={() => setIsHelpModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-300 transition shadow-sm"
              title="Open CRM Guide, SOP & Caller Playbook"
            >
              <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Guide &amp; SOP</span>
            </button>

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

      {/* Owner Caller Activity & Live Performance Tracker */}
      {isOwner && teamCallers.length > 0 && (
        <div className="border-b border-zinc-800/80 bg-[#0a0a0d] p-3 text-xs">
          <div className="flex items-center justify-between mb-2">
            <div className="flex flex-wrap items-center gap-2">
              <Users className="w-4 h-4 text-indigo-400" />
              <span className="font-bold text-white text-xs">Caller Activity &amp; Live Tracking</span>
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800">
                <span className="text-zinc-200 font-semibold">{callerStats.teamTotals.callsLogged} Calls Logged</span>
                <span>&bull;</span>
                <span className="text-emerald-400 font-semibold">{callerStats.teamTotals.meetings} Booked</span>
                <span>&bull;</span>
                <span className="text-sky-300 font-semibold">{callerStats.teamTotals.connected} Spoke</span>
                <span>&bull;</span>
                <span className="text-amber-300 font-medium">{callerStats.teamTotals.noAnswer} No Answer</span>
                <span>&bull;</span>
                <span className="text-orange-300 font-medium">{callerStats.teamTotals.gatekeeper} Gatekeeper</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/analytics"
                className="text-[11px] text-purple-400 hover:text-purple-300 font-semibold flex items-center gap-1 transition"
              >
                <TrendingUp className="w-3 h-3" />
                <span>Deep Funnel Analytics &rarr;</span>
              </Link>
              <button
                type="button"
                onClick={() => setIsPermissionsModalOpen(true)}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-medium flex items-center gap-1 transition"
              >
                <Shield className="w-3 h-3" />
                <span>Caller Access Settings</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
            <button
              type="button"
              onClick={() => setCallerFilter("ALL")}
              className={`p-2.5 rounded-lg border text-left transition ${
                callerFilter === "ALL"
                  ? "border-white bg-zinc-800/90 text-white shadow-sm"
                  : "border-zinc-800 bg-[#121215] text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">All Queue</div>
              <div className="text-base font-extrabold text-white mt-0.5">{totalCount} leads</div>
              <div className="text-[10px] text-emerald-400 mt-0.5">{meetingsCount} booked</div>
            </button>

            <button
              type="button"
              onClick={() => setCallerFilter("UNASSIGNED")}
              className={`p-2.5 rounded-lg border text-left transition ${
                callerFilter === "UNASSIGNED"
                  ? "border-amber-400 bg-amber-500/15 text-amber-200 shadow-sm"
                  : "border-zinc-800 bg-[#121215] text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider font-bold text-amber-400">Unassigned Pool</div>
              <div className="text-base font-extrabold text-white mt-0.5">{callerStats.unassignedCount} leads</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">Ready to assign</div>
            </button>

            {teamCallers.map((caller) => {
              const stats = callerStats.callerMap[caller.id] || {
                total: 0,
                callsLogged: 0,
                connected: 0,
                meetings: 0,
                followUps: 0,
                noAnswer: 0,
                gatekeeper: 0,
                voicemail: 0,
              };
              const isSelected = callerFilter === caller.id;
              return (
                <button
                  key={caller.id}
                  type="button"
                  onClick={() => setCallerFilter(isSelected ? "ALL" : caller.id)}
                  className={`p-2.5 rounded-lg border text-left transition ${
                    isSelected
                      ? "border-indigo-400 bg-indigo-500/20 text-indigo-100 shadow-sm"
                      : "border-zinc-800 bg-[#121215] text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-bold text-white truncate">{caller.name}</span>
                    <span className="text-[9px] text-zinc-400 shrink-0">{caller.title || "Caller"}</span>
                  </div>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-base font-extrabold text-white">{stats.total}</span>
                    <span className="text-[10px] text-zinc-400">leads</span>
                    <span className="text-zinc-600 ml-1">&bull;</span>
                    <span className="text-[10px] text-zinc-300 font-semibold">{stats.callsLogged} calls</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-[9px] mt-1.5 font-semibold">
                    <span className="px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {stats.meetings} Booked
                    </span>
                    <span className="px-1 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                      {stats.connected} Spoke
                    </span>
                    {stats.noAnswer > 0 && (
                      <span className="px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        {stats.noAnswer} No Answer
                      </span>
                    )}
                    {stats.gatekeeper > 0 && (
                      <span className="px-1 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30">
                        {stats.gatekeeper} Gatekeeper
                      </span>
                    )}
                    {stats.followUps > 0 && (
                      <span className="px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                        {stats.followUps} Follow-ups
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
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
            { key: "NO_ANSWER", label: `No Answer (${noAnswerCount})` },
            { key: "GATEKEEPER", label: `Gatekeeper (${gatekeeperCount})` },
            { key: "VOICEMAIL", label: `Voicemails (${voicemailCount})` },
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

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <ArrowUpDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded-lg border border-zinc-800 bg-[#09090b] px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none cursor-pointer"
              title="Sort lead sequence"
            >
              <option value="INTAKE_DATE">Sort: Intake Date (Newest first)</option>
              <option value="ICP_SCORE">Sort: ICP Score (High to Low)</option>
              <option value="NAME_AZ">Sort: Company Name (A-Z)</option>
              <option value="STAGE">Sort: Pipeline Stage</option>
            </select>
          </div>

          <div className="relative flex-1 sm:w-60">
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
                <th className="px-4 py-3 whitespace-nowrap min-w-[240px] max-w-[280px]">Company &amp; Location</th>
                <th className="px-3 py-3 whitespace-nowrap min-w-[210px] max-w-[260px]">Decision Maker &amp; LinkedIn</th>
                <th className="px-3 py-3 whitespace-nowrap min-w-[150px]">Direct Phone</th>
                {(isOwner || canManageSettings) && (
                  <th className="px-3 py-3 whitespace-nowrap min-w-[130px]">Assigned Caller</th>
                )}
                <th className="px-3 py-3 whitespace-nowrap min-w-[155px]">Pipeline Stage</th>
                {smartFields.map((field) => (
                  <th key={field.key} className="px-3 py-3 whitespace-nowrap min-w-[125px]">
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
                <th className="px-3 py-3 whitespace-nowrap min-w-[140px]">Next Follow-Up</th>
                <th className="px-3 py-3 whitespace-nowrap min-w-[260px] max-w-[340px]">Latest Note &amp; History</th>
                <th className="px-4 py-3 text-right whitespace-nowrap min-w-[120px]">
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
              {sortedLeads.map((lead, idx) => {
                const phone = lead.bestContact?.phone || lead.phoneDisplay;
                const dmName = lead.bestContact?.name;
                const dmTitle = lead.bestContact?.title;
                const dmLinkedin = lead.bestContact?.linkedinUrl || (lead.facts as any)?.["linkedin"] || null;
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${lead.name} ${lead.address || ""} ${lead.city || ""} ${lead.state || ""}`
                )}`;
                const followUpInfo = formatFollowUpLabel(lead.nextFollowUp);
                const parsedNote = parseLatestCallerNote(lead.notes);
                const dateInfo = classifyLeadDate(lead);
                const prevLead = idx > 0 ? sortedLeads[idx - 1] : null;
                const isNewBatch =
                  sortBy === "INTAKE_DATE" &&
                  (!prevLead || classifyLeadDate(prevLead).groupKey !== dateInfo.groupKey);

                return (
                  <React.Fragment key={lead.id}>
                    {isNewBatch && (
                      <tr className="bg-zinc-950 border-y border-zinc-800/80 sticky top-0 z-10">
                        <td colSpan={(isOwner || canManageSettings ? 8 : 7) + smartFields.length} className="px-4 py-2">
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
                      <td className="px-4 py-3.5 min-w-[240px] max-w-[280px]">
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
                          <div className="font-semibold text-white text-xs truncate">
                            <button
                              type="button"
                              onClick={() => canEdit && startInlineEdit(lead.id, "name", lead.name)}
                              className="group/name flex items-center gap-1.5 text-left truncate hover:text-emerald-300 transition w-full"
                              title="Click to edit company name inline"
                            >
                              <span className="truncate font-bold text-zinc-100 group-hover/name:text-emerald-300">{lead.name}</span>
                              {canEdit && (
                                <Pencil className="w-2.5 h-2.5 text-zinc-500 opacity-0 group-hover/name:opacity-100 transition shrink-0" />
                              )}
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-[11px] text-zinc-400 truncate mt-1">
                          <span>{lead.city ? `${lead.city}, ${lead.state}` : lead.state || "US"}</span>
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-0.5 transition"
                            title="Open in Google Maps"
                          >
                            <MapPin className="w-2.5 h-2.5" />
                            <span>Map</span>
                          </a>
                          {lead.website && (
                            <a
                              href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-0.5 transition"
                              title="Visit website"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              <span>Web</span>
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Decision Maker & LinkedIn */}
                      <td className="px-3 py-3.5 min-w-[210px] max-w-[260px]">
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
                            <div className="font-semibold text-zinc-200 text-xs truncate group-hover/dm:text-emerald-300 flex items-center gap-1">
                              <span>{dmName || "Owner / Manager"}</span>
                              {canEdit && (
                                <Pencil className="w-2.5 h-2.5 text-zinc-500 opacity-0 group-hover/dm:opacity-100 transition" />
                              )}
                            </div>
                          </button>
                        )}

                        <div className="flex items-center justify-between gap-1 mt-0.5">
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
                              className="w-full bg-[#09090b] border border-emerald-500 rounded px-2 py-0.5 text-[11px] text-zinc-200 focus:outline-none shadow-sm"
                              placeholder="Role / Title"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => canEdit && startInlineEdit(lead.id, "contactTitle", dmTitle || "")}
                              className="text-left group/title flex-1 flex items-center gap-1 text-[11px] text-zinc-400 truncate hover:text-zinc-200"
                              title="Click to edit role/title inline"
                            >
                              <span className="truncate">{dmTitle || "Decision Maker"}</span>
                              {canEdit && (
                                <Pencil className="w-2 h-2 text-zinc-500 opacity-0 group-hover/title:opacity-100 transition" />
                              )}
                            </button>
                          )}

                          {/* LinkedIn Profile Pill or Find LinkedIn link */}
                          {dmLinkedin ? (
                            <a
                              href={dmLinkedin.startsWith("http") ? dmLinkedin : `https://${dmLinkedin}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0a66c2]/15 text-[#38bdf8] hover:bg-[#0a66c2]/25 border border-[#0a66c2]/30 text-[10px] font-semibold transition"
                              title="Open LinkedIn Profile"
                            >
                              <svg className="w-2.5 h-2.5 text-[#38bdf8]" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
                              </svg>
                              <span>LinkedIn</span>
                            </a>
                          ) : (
                            <a
                              href={`https://www.google.com/search?q=${encodeURIComponent(
                                `${dmName || lead.name} ${lead.name} LinkedIn`
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-sky-400 transition"
                              title="Search LinkedIn on Google"
                            >
                              <Search className="w-2.5 h-2.5" />
                              <span>Find</span>
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Phone */}
                      <td className="px-3 py-3.5 whitespace-nowrap min-w-[150px]">
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

                      {/* Assigned Caller (Only visible to Owner and Managers) */}
                      {(isOwner || canManageSettings) && (
                        <td className="px-3 py-3.5 whitespace-nowrap min-w-[130px]">
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
                      )}

                      {/* Interactive Status Dropdown with Vivid Stage Badges */}
                      <td className="px-3 py-3.5 whitespace-nowrap min-w-[155px]">
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
                          <td key={field.key} className="px-3 py-3.5 whitespace-nowrap min-w-[125px]">
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
                      <td className="px-3 py-3.5 whitespace-nowrap min-w-[140px]">
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

                      {/* Latest Note & Call History */}
                      <td className="px-3 py-3.5 min-w-[260px] max-w-[340px]">
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
                          <div className="w-full">
                            {parsedNote && (parsedNote.cleanText || parsedNote.outcome) ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-1">
                                  {parsedNote.outcome ? (
                                    <span
                                      className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                                        parsedNote.outcome.includes("Meeting")
                                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                          : parsedNote.outcome.includes("Connected") || parsedNote.outcome.includes("Spoke")
                                          ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                                          : parsedNote.outcome.includes("Gatekeeper")
                                          ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
                                          : parsedNote.outcome.includes("No Answer")
                                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                          : parsedNote.outcome.includes("Voicemail")
                                          ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                                          : "bg-zinc-800 text-zinc-300 border-zinc-700"
                                      }`}
                                    >
                                      {parsedNote.outcome}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-zinc-500 font-medium">
                                      {parsedNote.timestamp || "Note"}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setViewingNotesHistoryLead(lead)}
                                    className="text-[10px] text-zinc-500 hover:text-zinc-300 underline shrink-0"
                                    title="View full call history and all notes"
                                  >
                                    History
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => canEditNotes && startInlineEdit(lead.id, "notes", stripFollowUpTagFromNotes(lead.notes) || "")}
                                  className="text-left w-full group/notes block"
                                  title="Click to edit notes inline (Enter to save)"
                                >
                                  <p className="text-[11px] text-zinc-200 font-medium line-clamp-2 group-hover/notes:text-white transition">
                                    {parsedNote.cleanText || "No additional note text."}
                                  </p>
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => canEditNotes && startInlineEdit(lead.id, "notes", "")}
                                className="text-zinc-500 hover:text-emerald-400 text-[11px] underline decoration-dotted flex items-center gap-1"
                              >
                                <Plus className="w-2.5 h-2.5" />
                                <span>Add note</span>
                              </button>
                            )}
                          </div>
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

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-[#38bdf8]" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/>
                  </svg>
                  <span>Decision Maker LinkedIn Profile URL</span>
                </label>
                <input
                  type="url"
                  value={editContactLinkedin}
                  onChange={(e) => setEditContactLinkedin(e.target.value)}
                  placeholder="https://www.linkedin.com/in/michael-carter"
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none placeholder-zinc-600"
                />
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
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Call Notes (Optional summary)
                  </label>
                  <span className="text-[10px] text-zinc-500">
                    Leave blank to auto-record standard outcome note
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Write a quick summary of the call or objections (leave empty for auto note)..."
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

      {/* Call History & Notes History Modal */}
      {viewingNotesHistoryLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-400" />
                  <span>Call History &amp; Notes: {viewingNotesHistoryLead.name}</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {viewingNotesHistoryLead.bestContact?.name || "Owner/Manager"} &bull;{" "}
                  {viewingNotesHistoryLead.bestContact?.phone || viewingNotesHistoryLead.phoneDisplay || "No Phone"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingNotesHistoryLead(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-3 overflow-y-auto flex-1">
              {viewingNotesHistoryLead.notes ? (
                viewingNotesHistoryLead.notes
                  .split("\n")
                  .filter((line) => line.trim())
                  .map((line, lineIdx) => {
                    const isFollowUpLine = line.includes("Next Follow-up Scheduled");
                    return (
                      <div
                        key={lineIdx}
                        className={`p-3 rounded-lg border text-xs leading-relaxed ${
                          isFollowUpLine
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                            : "border-zinc-800 bg-[#09090b] text-zinc-300"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{line}</p>
                      </div>
                    );
                  })
              ) : (
                <div className="py-8 text-center text-xs text-zinc-500">
                  No call history or notes recorded for this lead yet.
                </div>
              )}
            </div>

            <div className="p-4 border-t border-zinc-800 flex items-center justify-between bg-[#0c0c0f]">
              <button
                type="button"
                onClick={() => setViewingNotesHistoryLead(null)}
                className="px-3.5 py-1.5 rounded-lg text-zinc-400 hover:text-white text-xs font-medium"
              >
                Close
              </button>
              {canCall && (
                <button
                  type="button"
                  onClick={() => {
                    const target = viewingNotesHistoryLead;
                    setViewingNotesHistoryLead(null);
                    openCallModal(target);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-bold transition shadow-sm"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>Log New Call</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Owner Granular Caller Permissions Modal */}
      {isPermissionsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Caller Permissions &amp; Access Controls</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Set live permissions for each sales caller. Changes apply immediately in their dashboard.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPermissionsModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {teamCallers.length === 0 ? (
                <p className="text-xs text-zinc-400">No active callers found in workspace settings.</p>
              ) : (
                teamCallers.map((caller) => {
                  const perms = caller.permissions || {
                    callerWorkbench: true,
                    editContacts: true,
                    exportAndSync: false,
                    discoverLeads: false,
                    viewAnalytics: false,
                    manageTeam: false,
                    manageSettings: false,
                  };

                  const togglePerm = async (key: keyof TeamPermissions) => {
                    const nextPerms = { ...perms, [key]: !perms[key] };
                    caller.permissions = nextPerms;
                    const res = await updateTeamMemberAccessAction(caller.id, {
                      permissions: nextPerms,
                    });
                    if (res.ok) {
                      setSyncFeedback(`Updated ${key} for ${caller.name}.`);
                      setTimeout(() => setSyncFeedback(null), 2000);
                    } else {
                      alert(res.error || "Failed to update caller permission");
                    }
                  };

                  return (
                    <div key={caller.id} className="p-4 rounded-xl border border-zinc-800 bg-[#09090b] space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-white text-xs border border-zinc-700">
                            {caller.name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-white text-xs">{caller.name}</div>
                            <div className="text-[10px] text-zinc-400">{caller.email} &bull; {caller.title || caller.role}</div>
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                          Active Caller
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-zinc-800/80 text-xs">
                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[#121215] border border-zinc-800/60 cursor-pointer hover:border-zinc-700 transition">
                          <input
                            type="checkbox"
                            checked={Boolean(perms.callerWorkbench)}
                            onChange={() => togglePerm("callerWorkbench")}
                            className="mt-0.5 rounded border-zinc-700 text-emerald-500 focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <div className="font-semibold text-zinc-200 text-[11px]">Caller Workbench &amp; Log Call</div>
                            <div className="text-[10px] text-zinc-500">Allow caller to dial and save call notes</div>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[#121215] border border-zinc-800/60 cursor-pointer hover:border-zinc-700 transition">
                          <input
                            type="checkbox"
                            checked={Boolean(perms.editContacts)}
                            onChange={() => togglePerm("editContacts")}
                            className="mt-0.5 rounded border-zinc-700 text-emerald-500 focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <div className="font-semibold text-zinc-200 text-[11px]">Edit Contact Info &amp; Notes</div>
                            <div className="text-[10px] text-zinc-500">Allow editing decision maker, phone &amp; notes</div>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[#121215] border border-zinc-800/60 cursor-pointer hover:border-zinc-700 transition">
                          <input
                            type="checkbox"
                            checked={Boolean(perms.discoverLeads)}
                            onChange={() => togglePerm("discoverLeads")}
                            className="mt-0.5 rounded border-zinc-700 text-emerald-500 focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <div className="font-semibold text-zinc-200 text-[11px]">Lead Discovery Access</div>
                            <div className="text-[10px] text-zinc-500">Allow finding and extracting new leads</div>
                          </div>
                        </label>

                        <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-[#121215] border border-zinc-800/60 cursor-pointer hover:border-zinc-700 transition">
                          <input
                            type="checkbox"
                            checked={Boolean(perms.exportAndSync)}
                            onChange={() => togglePerm("exportAndSync")}
                            className="mt-0.5 rounded border-zinc-700 text-emerald-500 focus:ring-0 cursor-pointer"
                          />
                          <div>
                            <div className="font-semibold text-zinc-200 text-[11px]">CSV Export &amp; Sync</div>
                            <div className="text-[10px] text-zinc-500">Allow downloading CRM CSV lists</div>
                          </div>
                        </label>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-4 border-t border-zinc-800 flex items-center justify-end bg-[#0c0c0f]">
              <button
                type="button"
                onClick={() => setIsPermissionsModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-bold transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SOP & Guidance Modal */}
      {isHelpModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="max-w-4xl w-full bg-[#0d0d11] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-[#121216]">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <HelpCircle className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-base">CRM Operating Guide &amp; Caller Playbook</h3>
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                      Standard Operating Procedure
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Clear guidance on table editing, call outcome logging, gatekeeper bypassing, and objection battlecards.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsHelpModalOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center border-b border-zinc-800 bg-[#0a0a0d] px-4 overflow-x-auto">
              <button
                type="button"
                onClick={() => setHelpTab("CRM")}
                className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                  helpTab === "CRM"
                    ? "border-amber-400 text-amber-300 bg-amber-500/5"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <BookOpen className="w-4 h-4" />
                <span>CRM &amp; Table SOP</span>
              </button>

              <button
                type="button"
                onClick={() => setHelpTab("CALLING")}
                className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                  helpTab === "CALLING"
                    ? "border-amber-400 text-amber-300 bg-amber-500/5"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Phone className="w-4 h-4" />
                <span>Call Outcomes &amp; Logging</span>
              </button>

              <button
                type="button"
                onClick={() => setHelpTab("GATEKEEPER")}
                className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                  helpTab === "GATEKEEPER"
                    ? "border-amber-400 text-amber-300 bg-amber-500/5"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Gatekeeper Bypass Playbook</span>
              </button>

              <button
                type="button"
                onClick={() => setHelpTab("OBJECTIONS")}
                className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                  helpTab === "OBJECTIONS"
                    ? "border-amber-400 text-amber-300 bg-amber-500/5"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Target className="w-4 h-4" />
                <span>Scripts &amp; Objections</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-sm text-zinc-300 flex-1">
              {helpTab === "CRM" && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-[#141419] border border-zinc-800">
                      <div className="flex items-center gap-2 text-white font-semibold text-xs mb-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Live Inline Note Editing</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Click directly on any Note cell in the table to edit in real time. There is no complicated popup required. When you type or update, it saves automatically to the database without page reloads.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-[#141419] border border-zinc-800">
                      <div className="flex items-center gap-2 text-white font-semibold text-xs mb-2">
                        <Shield className="w-4 h-4 text-indigo-400" />
                        <span>Owner Security &amp; Contact Protection</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Company names, decision maker names, and phone numbers are locked to prevent accidental corruption. Owners can grant or revoke caller edit permissions anytime via <strong className="text-zinc-200">Caller Controls</strong>.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-[#141419] border border-zinc-800">
                      <div className="flex items-center gap-2 text-white font-semibold text-xs mb-2">
                        <ArrowUpDown className="w-4 h-4 text-sky-400" />
                        <span>Date &amp; Batch Organization</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Leads are grouped by intake date. Yesterday&apos;s leads and today&apos;s batch are maintained cleanly so callers never work disordered queues. Use the status tabs to focus on follow-ups or untouched leads.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-[#141419] border border-zinc-800">
                      <div className="flex items-center gap-2 text-white font-semibold text-xs mb-2">
                        <Users className="w-4 h-4 text-amber-400" />
                        <span>Caller Queue Isolation</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        When a lead is assigned to a caller, it automatically routes to their personalized <strong className="text-zinc-200">Caller Workbench (/caller)</strong>. Callers see only their leads and dial statistics.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300/90 leading-relaxed flex items-start gap-3">
                    <Lightbulb className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-amber-200">Pro Tip for Callers:</strong> Always keep the <strong className="text-white">Caller Workbench (/caller)</strong> open during calling sessions. It offers instant 1-click dialing, objection battlecards, and streamlined outcome logging.
                    </div>
                  </div>
                </div>
              )}

              {helpTab === "CALLING" && (
                <div className="space-y-4">
                  <p className="text-xs text-zinc-400">
                    Always log the exact outcome after every dial. Logging an outcome synchronizes the CRM stage and appends a time-stamped note automatically.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-[#141419] border border-zinc-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-xs flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
                          No Answer / Rang Out
                        </span>
                        <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">Attempted</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        <strong className="text-zinc-300">When to use:</strong> Phone rang 4–5 times with no pickup, went to automated voicemail, or gave busy tone.
                      </p>
                      <div className="text-[11px] text-zinc-500 border-t border-zinc-800/80 pt-2">
                        System automatically auto-records note if left empty. Re-attempt at a different time of day.
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[#141419] border border-orange-500/20 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-orange-400 text-xs flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                          Gatekeeper Blocked
                        </span>
                        <span className="text-[10px] bg-orange-950/60 border border-orange-800 text-orange-300 px-2 py-0.5 rounded font-mono">Attempted</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        <strong className="text-zinc-300">When to use:</strong> Receptionist, assistant, or operator answered and refused to connect you to the owner.
                      </p>
                      <div className="text-[11px] text-zinc-500 border-t border-zinc-800/80 pt-2">
                        Note the receptionist&apos;s name and ask when the owner is directly available.
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[#141419] border border-sky-500/20 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sky-400 text-xs flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
                          Connected / Spoke
                        </span>
                        <span className="text-[10px] bg-sky-950/60 border border-sky-800 text-sky-300 px-2 py-0.5 rounded font-mono">Connected</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        <strong className="text-zinc-300">When to use:</strong> You reached the Decision Maker (Owner/CEO/Managing Director) and had a conversation.
                      </p>
                      <div className="text-[11px] text-zinc-500 border-t border-zinc-800/80 pt-2">
                        Record their interest level, current pipeline setup, and when to follow up.
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[#141419] border border-emerald-500/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-emerald-400 text-xs flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                          Meeting Booked
                        </span>
                        <span className="text-[10px] bg-emerald-950/60 border border-emerald-800 text-emerald-300 px-2 py-0.5 rounded font-mono">Meeting Scheduled</span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        <strong className="text-zinc-300">When to use:</strong> Prospect agreed to a demo, strategy session, or Zoom presentation.
                      </p>
                      <div className="text-[11px] text-zinc-500 border-t border-zinc-800/80 pt-2 text-emerald-400/90 font-medium">
                        Enter the confirmed Date &amp; Time in the Next Follow-Up field.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {helpTab === "GATEKEEPER" && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-[#141419] border border-zinc-800 space-y-3">
                    <h4 className="font-bold text-white text-xs uppercase tracking-wider text-amber-400">
                      Golden Rule: Casual Authority
                    </h4>
                    <p className="text-xs text-zinc-300 leading-relaxed">
                      Gatekeepers screen out salespeople who sound scripted, overly excited, or insecure. Use a calm, downward vocal inflection. Speak as if you already work with the owner.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="p-4 rounded-xl bg-[#121216] border border-zinc-800/80 space-y-2">
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400">Technique 1</span>
                        <span>First-Name Only Transfer</span>
                      </div>
                      <div className="text-xs text-emerald-400 font-mono bg-zinc-950/60 p-2.5 rounded border border-zinc-800/60">
                        &ldquo;Hey, is Alex in today?&rdquo;
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        If they ask <em className="text-zinc-300">&ldquo;Who&apos;s calling?&rdquo;</em>, respond simply: <strong className="text-white">&ldquo;It&apos;s [Your Name], is he at his desk?&rdquo;</strong> Do not explain your company or pitch the receptionist.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-[#121216] border border-zinc-800/80 space-y-2">
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400">Technique 2</span>
                        <span>Company Property Context</span>
                      </div>
                      <div className="text-xs text-emerald-400 font-mono bg-zinc-950/60 p-2.5 rounded border border-zinc-800/60">
                        &ldquo;Hi, I&apos;m calling for [Owner Name] regarding [Company Name]&apos;s local property acquisitions. Could you patch me through to his extension?&rdquo;
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        Sounds operational rather than transactional. Most gatekeepers will transfer directly.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-[#121216] border border-zinc-800/80 space-y-2">
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400">Technique 3</span>
                        <span>Off-Hours Calling Strategy</span>
                      </div>
                      <p className="text-xs text-zinc-300 leading-relaxed">
                        Gatekeepers work standard 9:00 AM – 5:00 PM hours. Business owners and executives are frequently at their desks early (8:00 AM – 8:45 AM) or late (5:00 PM – 5:45 PM). Calling during these windows yields 2.5x higher direct connection rates.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {helpTab === "OBJECTIONS" && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-[#141419] border border-indigo-500/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-indigo-300 text-xs uppercase tracking-wider">
                        15-Second Cold Call Opening Hook
                      </span>
                      <span className="text-[10px] bg-indigo-950/60 border border-indigo-800 text-indigo-300 px-2 py-0.5 rounded font-mono">82% Permission Rate</span>
                    </div>
                    <div className="text-xs text-zinc-200 font-mono bg-zinc-950/70 p-3 rounded-lg border border-zinc-800 leading-relaxed">
                      &ldquo;Hey [First Name], it&apos;s [Your Name] with AstraVenta. I know I caught you out of the blue—do you have 30 seconds to tell me if I should hang up or keep going?&rdquo;
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      When they smile or say &ldquo;Go ahead&rdquo;, immediately deliver the value hook: <br />
                      <span className="text-zinc-300">&ldquo;We just helped a local commercial partner secure 18 verified property seller leads last month. I wanted to see if you have capacity for 5 to 10 more qualified deals this quarter?&rdquo;</span>
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="p-3.5 rounded-xl bg-[#121216] border border-zinc-800 space-y-1.5">
                      <div className="text-xs font-bold text-amber-400 flex items-center gap-2">
                        <span>Objection:</span>
                        <span className="text-white">&ldquo;Just send me an email.&rdquo;</span>
                      </div>
                      <div className="text-xs text-emerald-400 font-mono bg-zinc-950/60 p-2.5 rounded border border-zinc-800/60">
                        &ldquo;I can definitely send that over. To make sure I don&apos;t flood your inbox with generic info—are you currently handling your property acquisitions in-house or relying on agencies right now?&rdquo;
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        Converts a brush-off into an active discovery conversation.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#121216] border border-zinc-800 space-y-1.5">
                      <div className="text-xs font-bold text-amber-400 flex items-center gap-2">
                        <span>Objection:</span>
                        <span className="text-white">&ldquo;We&apos;re not interested.&rdquo;</span>
                      </div>
                      <div className="text-xs text-emerald-400 font-mono bg-zinc-950/60 p-2.5 rounded border border-zinc-800/60">
                        &ldquo;Totally understood! Most partners weren&apos;t looking either until they saw how we eliminated dead leads. Before I let you go—is that because you&apos;re fully booked, or just bad timing today?&rdquo;
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-[#121216] border border-zinc-800 space-y-1.5">
                      <div className="text-xs font-bold text-amber-400 flex items-center gap-2">
                        <span>Objection:</span>
                        <span className="text-white">&ldquo;We already have a lead provider / system.&rdquo;</span>
                      </div>
                      <div className="text-xs text-emerald-400 font-mono bg-zinc-950/60 p-2.5 rounded border border-zinc-800/60">
                        &ldquo;That makes complete sense, and we wouldn&apos;t ask you to replace them. Most clients use our verified pipeline as a secondary benchmark. When was the last time you evaluated your cost per qualified deal?&rdquo;
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-zinc-800 flex items-center justify-between bg-[#0c0c0f]">
              <div className="text-[11px] text-zinc-500">
                AstraVenta CRM SOP v2.4 &bull; Standard Operating Framework
              </div>
              <button
                type="button"
                onClick={() => setIsHelpModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black text-xs font-bold transition shadow-sm"
              >
                Got It
              </button>
            </div>
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
