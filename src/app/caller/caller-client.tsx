"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { type CallerLeadView } from "@/server/repo/caller";
import {
  logCallFeedbackAction,
  assignLeadAction,
  autoDistributeLeadsAction,
  updateLeadCrmDetailsAction,
  updateLeadStatusQuickAction,
  updateLeadFollowUpAction,
  createManualCrmLeadAction,
  deleteCrmLeadAction,
  updateLeadSmartFieldAction,
  addCustomCrmColumnAction,
  deleteCustomCrmColumnAction,
  assignBulkLeadsToCallerAction,
  unassignCallerLeadsAction,
} from "./actions";
import { type TeamMember, ROLE_PRESETS } from "@/server/domain/team";
import type { LifecycleStatus } from "@/server/domain/lifecycle";
import {
  getSmartFieldsForNiche,
  resolveSmartFieldValue,
  type CustomCrmColumn,
  type NicheSmartField,
} from "@/server/domain/niche-fields";
import {
  CrmLeadSheet,
  type CrmLeadItem,
  CRM_STAGE_OPTIONS,
  formatFollowUpLabel,
  buildPresetFollowUpIso,
  stripFollowUpTagFromNotes,
} from "@/components/crm-lead-sheet";
import { classifyLeadDate, type LeadDateCategory } from "@/components/crm-date-utils";
import {
  DEFAULT_DIALER_CONFIG,
  type DialerConfig,
} from "@/server/domain/dialer";
import { LeadImportModal } from "@/components/lead-import-modal";
import { ActiveQualityGateCard } from "@/components/active-quality-gate-card";
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
  Upload,
  Sparkles,
  Users,
  Mail,
  Pencil,
  Plus,
  Trash2,
  Clock,
  FileText,
} from "lucide-react";

interface CallerClientProps {
  initialQueue: CallerLeadView[];
  initialCallerFilter?: string;
  nicheName?: string;
  nicheCategory?: string;
  initialCustomColumns?: CustomCrmColumn[];
  marketId?: string;
  dialerConfig?: DialerConfig;
  activeActorName?: string;
  activeMember?: TeamMember;
  allMembers?: TeamMember[];
  permissions?: TeamPermissions;
  initialRuleConfig?: any;
  canEditRules?: boolean;
}

function getSmartOpeningScript({
  companyName,
  contactName,
  city,
  state,
  nicheName = "Target Niche",
  cleanNotes,
  researchSummary,
}: {
  companyName: string;
  contactName?: string | null;
  city?: string | null;
  state?: string | null;
  nicheName?: string;
  cleanNotes?: string | null;
  researchSummary?: string | null;
}): string {
  // 1. If an AI-researched battlecard already generated a tailored 15-second opening script, use it!
  const sourceText = researchSummary || cleanNotes || "";
  if (sourceText) {
    const match = sourceText.match(/15-SECOND OPENING SCRIPT:\s*["“]?([^"”\n\r]+(?:\r?\n[^"”\n\r]+)*)["”]?/i);
    if (match && match[1]) {
      const extracted = match[1].trim().replace(/^["“]|["”]$/g, "");
      if (extracted.length > 20) return extracted;
    }
  }

  // 2. Synthesize an authentic, high-intent script tailored to the exact industry / niche!
  const targetGreeting = contactName ? `Hey ${contactName.split(" ")[0]}` : "Hey there";
  const location = [city, state].filter(Boolean).join(", ") || "your local area";
  const lowerNiche = (nicheName || "").toLowerCase();

  if (/real estate|property management|realty|realtor|brokerage|leasing/i.test(lowerNiche)) {
    return `${targetGreeting}, noticed ${companyName} manages active property listings and real estate client operations in ${location}. The reason for my call: established real estate and property management principals tell us that after-hours buyer inquiries and tenant placement requests often wait hours for response, losing high-value deals. We build custom backend AI intake engines that qualify inbound buyer, seller, and tenant leads and book appointments onto your calendar 24/7. Do you guys currently have an automated instant response system for your property inquiries?`;
  }

  if (/hvac|heating|air conditioning|cooling|plumbing|roofing|electric|contractor/i.test(lowerNiche)) {
    return `${targetGreeting}, noticed ${companyName} handles residential installations and mechanical services in ${location}. The reason for my call: established trade owners in the area tell us that after-hours estimate follow-ups often sit idle while techs are in the field, losing big-ticket installation bids to competitors. We build custom AI follow-up engines that automatically re-engage open replacement estimates and book installation jobs onto your schedule. Do you guys currently have an automated follow-up system in place for your open bids?`;
  }

  if (/medical|clinic|healthcare|doctor|physician|dental|dentist|wellness/i.test(lowerNiche)) {
    return `${targetGreeting}, noticed ${companyName} provides specialized clinical care in ${location}. The reason for my call: clinical directors tell us that front-desk staff are often tied up with in-person patients, meaning inbound new-patient inquiries and consultation requests get delayed. We deploy HIPAA-compliant AI intake assistants that pre-qualify inquiries and schedule consultations directly onto the calendar 24/7. Does your clinic currently use automated 24/7 intake for new patient inquiries?`;
  }

  return `${targetGreeting}, noticed ${companyName} is an established provider in ${location}. The reason for my call: many top leaders in ${nicheName} tell us that inbound web inquiries and consultation requests often sit idle after hours before staff can follow up. We deploy custom backend AI intake & follow-up engines that qualify high-intent inquiries and book appointments onto your calendar 24/7. Do you currently have an automated instant follow-up system for your inbound inquiries?`;
}

export function CallerClient({
  initialQueue,
  initialCallerFilter = "ALL",
  nicheName = "Active Niche",
  nicheCategory,
  initialCustomColumns = [],
  marketId,
  dialerConfig = DEFAULT_DIALER_CONFIG,
  activeActorName = "Sales Caller",
  activeMember,
  allMembers = [],
  permissions,
  initialRuleConfig = {},
  canEditRules = false,
}: CallerClientProps) {
  const [queue, setQueue] = useState<CallerLeadView[]>(initialQueue);
  const [customColumns, setCustomColumns] = useState<CustomCrmColumn[]>(initialCustomColumns);
  const [search, setSearch] = useState("");
  const [callerFilter, setCallerFilter] = useState<string>(initialCallerFilter || "ALL");
  const [bulkAssignCallerId, setBulkAssignCallerId] = useState<string>("");

  // Add Custom Column Modal State
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState("");
  const [newColumnOptions, setNewColumnOptions] = useState(
    "Confirmed, Yes, No, Ask on Call"
  );
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [expandedScriptId, setExpandedScriptId] = useState<string | null>(null);
  const [expandedNotesIds, setExpandedNotesIds] = useState<Record<string, boolean>>({});
  const [expandAllNotes, setExpandAllNotes] = useState(false);

  const toggleNotesExpanded = (companyId: string) => {
    setExpandedNotesIds((prev) => ({
      ...prev,
      [companyId]: !prev[companyId],
    }));
  };

  const handleToggleExpandAllNotes = () => {
    const next = !expandAllNotes;
    setExpandAllNotes(next);
    const updated: Record<string, boolean> = {};
    queue.forEach((l) => {
      updated[l.companyId] = next;
    });
    setExpandedNotesIds(updated);
  };

  const smartFields = getSmartFieldsForNiche(nicheCategory, nicheName, customColumns);

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [distributePending, startDistribute] = useTransition();
  const [assignPendingId, setAssignPendingId] = useState<string | null>(null);
  const [crmToast, setCrmToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setCrmToast(msg);
    setTimeout(() => setCrmToast(null), 3500);
  };

  const isOwner = !activeMember || activeMember.role === "OWNER";
  const canDiscover = isOwner || Boolean(permissions?.discoverLeads);
  const canImport = isOwner || Boolean(permissions?.discoverLeads || permissions?.exportAndSync);
  const canExport = isOwner || Boolean(permissions?.exportAndSync);
  const canManageSettings = isOwner || Boolean(permissions?.manageTeamAndSettings);
  const canEditContacts =
    !permissions || permissions.editContacts || permissions.callerWorkbench;

  const handleAutoDistribute = () => {
    if (!marketId) return;
    startDistribute(async () => {
      const res = await autoDistributeLeadsAction({ marketId });
      if (res.ok) {
        showToast(
          `Distributed ${res.distributedCount} leads evenly across ${res.membersCount} active callers.`
        );
        window.location.reload();
      } else {
        showToast(res.error || "Failed to distribute leads");
      }
    });
  };

  const handleAssignLead = async (leadId: string, memberId: string) => {
    setAssignPendingId(leadId);
    const target = allMembers.find((m) => m.id === memberId);
    setQueue((prev) =>
      prev.map((l) =>
        l.companyId === leadId
          ? {
              ...l,
              assignedMemberId: memberId || null,
              assignedMemberName: target?.name || null,
            }
          : l
      )
    );
    const res = await assignLeadAction({
      companyId: leadId,
      memberId: memberId || null,
      memberName: target?.name || null,
    });
    setAssignPendingId(null);
    if (res.ok) {
      showToast(
        target ? `Assigned lead to ${target.name}.` : "Lead marked as unassigned."
      );
    }
  };

  // 1-Click Niche Smart Field / Custom Column Update
  const handleSmartFieldChange = async (
    lead: CallerLeadView,
    field: NicheSmartField,
    nextValue: string
  ) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.companyId === lead.companyId
          ? {
              ...item,
              facts: { ...(item.facts || {}), [field.key]: nextValue },
            }
          : item
      )
    );
    const res = await updateLeadSmartFieldAction({
      companyId: lead.companyId,
      fieldKey: field.key,
      value: nextValue,
    });
    if (res.ok) {
      showToast(`Updated ${field.shortLabel} for ${lead.name} to "${nextValue}".`);
    }
  };

  // Add Custom Column
  const handleCreateCustomColumn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!marketId || !newColumnLabel.trim()) return;
    const opts = newColumnOptions
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);

    startTransition(async () => {
      const res = await addCustomCrmColumnAction({
        marketId,
        label: newColumnLabel.trim(),
        options: opts,
      });
      if (res.ok && res.columns) {
        setCustomColumns(res.columns);
        setIsAddingColumn(false);
        setNewColumnLabel("");
        showToast(`Added custom CRM column "${newColumnLabel.trim()}".`);
      } else {
        showToast(res.error || "Failed to add custom column");
      }
    });
  };

  // Delete Custom Column
  const handleDeleteCustomColumn = (columnKey: string) => {
    if (!marketId) return;
    startTransition(async () => {
      const res = await deleteCustomCrmColumnAction({ marketId, columnKey });
      if (res.ok && res.columns) {
        setCustomColumns(res.columns);
        showToast("Removed custom CRM column.");
      }
    });
  };

  // Bulk Assign Unassigned Leads to Selected Caller
  const handleBulkAssignToCaller = () => {
    if (!marketId || !bulkAssignCallerId) return;
    const targetCaller = allMembers.find((m) => m.id === bulkAssignCallerId);
    if (!targetCaller) return;

    startDistribute(async () => {
      const res = await assignBulkLeadsToCallerAction({
        marketId,
        memberId: targetCaller.id,
        memberName: targetCaller.name,
        onlyUnassigned: true,
      });
      if (res.ok) {
        setQueue((prev) =>
          prev.map((l) =>
            !l.assignedMemberId
              ? {
                  ...l,
                  assignedMemberId: targetCaller.id,
                  assignedMemberName: targetCaller.name,
                }
              : l
          )
        );
        showToast(
          `Assigned ${res.assignedCount || 0} unassigned leads to ${targetCaller.name}.`
        );
      } else {
        showToast(res.error || "Failed to assign leads");
      }
    });
  };

  // Bulk Unassign Leads from Specific Caller back to Unassigned Pool
  const handleUnassignCallerLeads = (callerId: string) => {
    if (!marketId || !callerId) return;
    const targetCaller = allMembers.find((m) => m.id === callerId);

    startDistribute(async () => {
      const res = await unassignCallerLeadsAction({
        marketId,
        memberId: callerId,
      });
      if (res.ok) {
        setQueue((prev) =>
          prev.map((l) =>
            l.assignedMemberId === callerId
              ? {
                  ...l,
                  assignedMemberId: null,
                  assignedMemberName: null,
                }
              : l
          )
        );
        showToast(
          `Unassigned ${res.unassignedCount || 0} leads from ${targetCaller?.name || "caller"}. Returned to Unassigned Pool.`
        );
      } else {
        showToast(res.error || "Failed to unassign leads");
      }
    });
  };

  const [selectedLead, setSelectedLead] = useState<CallerLeadView | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"CARDS" | "SHEET">("CARDS");
  const [dateFilter, setDateFilter] = useState<"ALL" | "TODAY" | "YESTERDAY" | "OLDER">("ALL");
  const [collapsedDateGroups, setCollapsedDateGroups] = useState<Record<string, boolean>>({});

  const toggleCollapseDateGroup = (groupKey: string) => {
    setCollapsedDateGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  React.useEffect(() => {
    const savedView = localStorage.getItem("astraventa_caller_default_view");
    if (savedView === "SHEET" || savedView === "CARDS") {
      setViewMode(savedView);
    }
  }, []);

  // Form state for Log Call modal
  const [isPending, startTransition] = useTransition();
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmedSoftware, setConfirmedSoftware] = useState("");
  const [confirmedFleet, setConfirmedFleet] = useState<string>("");
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Follow-Up Quick Scheduler Modal State
  const [followUpTarget, setFollowUpTarget] = useState<CallerLeadView | null>(null);
  const [followUpInput, setFollowUpInput] = useState<string>("");
  const [followUpNote, setFollowUpNote] = useState<string>("");

  // Full Edit Lead Modal State
  const [editingLead, setEditingLead] = useState<CallerLeadView | null>(null);
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

  // Add Manual Lead Modal State
  const [isAddingLead, setIsAddingLead] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newContactTitle, setNewContactTitle] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newWebsite, setNewWebsite] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("TX");
  const [newFollowUp, setNewFollowUp] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // 1-Click Pipeline Stage Update
  const handleQuickStatusChange = async (
    lead: CallerLeadView,
    nextStatus: LifecycleStatus
  ) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.companyId === lead.companyId ? { ...item, status: nextStatus } : item
      )
    );
    const res = await updateLeadStatusQuickAction({
      companyId: lead.companyId,
      status: nextStatus,
    });
    if (res.ok) {
      const stageLabel =
        CRM_STAGE_OPTIONS.find((s) => s.value === nextStatus)?.label || nextStatus;
      showToast(`Moved ${lead.name} to "${stageLabel}".`);
    } else {
      showToast(res.error || "Could not update pipeline stage");
    }
  };

  // Open Quick Follow-Up Modal
  const openFollowUpModal = (lead: CallerLeadView) => {
    setFollowUpTarget(lead);
    setFollowUpInput(lead.nextFollowUp || buildPresetFollowUpIso("TOMORROW"));
    setFollowUpNote("");
  };

  const handleSaveFollowUp = (overrideDate?: string | null) => {
    if (!followUpTarget) return;
    const targetId = followUpTarget.companyId;
    const targetName = followUpTarget.name;
    const dateToSave =
      overrideDate !== undefined ? overrideDate : followUpInput.trim() || null;

    setQueue((prev) =>
      prev.map((item) =>
        item.companyId === targetId
          ? {
              ...item,
              nextFollowUp: dateToSave,
            }
          : item
      )
    );
    setFollowUpTarget(null);

    startTransition(async () => {
      const res = await updateLeadFollowUpAction({
        companyId: targetId,
        followUpDate: dateToSave,
        note: followUpNote.trim() || null,
      });
      if (res.ok) {
        setQueue((prev) =>
          prev.map((item) =>
            item.companyId === targetId
              ? {
                  ...item,
                  nextFollowUp: res.nextFollowUp ?? null,
                  notes: res.updatedNotes ?? item.notes,
                }
              : item
          )
        );
        showToast(
          dateToSave
            ? `Scheduled follow-up for ${targetName} (${formatFollowUpLabel(dateToSave).text}).`
            : `Marked follow-up completed for ${targetName}.`
        );
      } else {
        showToast(res.error || "Could not update follow-up");
      }
    });
  };

  // Open Full Edit Lead Modal
  const openEditModal = (lead: CallerLeadView) => {
    setEditingLead(lead);
    setEditName(lead.name || "");
    setEditContactName(lead.bestContact.name || "");
    setEditContactTitle(lead.bestContact.title || "");
    setEditPhone(lead.bestContact.phone || lead.phone || "");
    setEditEmail(lead.bestContact.email || "");
    setEditWebsite(lead.website || "");
    setEditCity(lead.city || "");
    setEditState(lead.state || "");
    setEditStatus(lead.status);
    setEditFollowUp(lead.nextFollowUp || "");
    setEditNotes(stripFollowUpTagFromNotes(lead.notes));
    setEditAssignedId(lead.assignedMemberId || "");
  };

  const handleSaveEditLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLead) return;
    const targetId = editingLead.companyId;
    const assignedObj = allMembers.find((m) => m.id === editAssignedId);

    const combinedNotes = editFollowUp
      ? editNotes.trim()
        ? `[Next Follow-up Scheduled: ${editFollowUp}]\n${editNotes.trim()}`
        : `[Next Follow-up Scheduled: ${editFollowUp}]`
      : editNotes.trim() || null;

    setQueue((prev) =>
      prev.map((item) =>
        item.companyId === targetId
          ? {
              ...item,
              name: editName.trim() || item.name,
              phone: editPhone.trim() || null,
              website: editWebsite.trim() || null,
              city: editCity.trim() || null,
              state: editState.trim().toUpperCase() || null,
              status: editStatus,
              nextFollowUp: editFollowUp || null,
              notes: combinedNotes,
              assignedMemberId: editAssignedId || null,
              assignedMemberName: assignedObj?.name || null,
              bestContact: {
                ...item.bestContact,
                name: editContactName.trim() || null,
                title: editContactTitle.trim() || null,
                phone: editPhone.trim() || null,
                email: editEmail.trim() || null,
              },
            }
          : item
      )
    );
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
        assignedMemberId: editAssignedId || null,
        assignedMemberName: assignedObj?.name || null,
      });

      if (res.ok) {
        showToast(`Updated CRM record for ${editName.trim()}.`);
      } else {
        showToast(res.error || "Failed to update lead");
      }
    });
  };

  // Delete / Archive Lead
  const handleDeleteLead = (companyId: string, name: string) => {
    setQueue((prev) => prev.filter((l) => l.companyId !== companyId));
    setEditingLead(null);
    startTransition(async () => {
      const res = await deleteCrmLeadAction({ companyId });
      if (res.ok) {
        showToast(`Removed ${name} from active CRM.`);
      }
    });
  };

  // Create Manual Lead
  const handleCreateManualLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!marketId || !newName.trim() || !newPhone.trim()) return;

    startTransition(async () => {
      const res = await createManualCrmLeadAction({
        marketId,
        name: newName.trim(),
        phone: newPhone.trim(),
        website: newWebsite.trim() || null,
        city: newCity.trim() || null,
        state: newState.trim().toUpperCase() || "TX",
        contactName: newContactName.trim() || null,
        contactTitle: newContactTitle.trim() || "Owner / Decision Maker",
        contactEmail: newEmail.trim() || null,
        nextFollowUp: newFollowUp || null,
        notes: newNotes.trim() || null,
        assignedMemberId: activeMember?.id || null,
        assignedMemberName: activeMember?.name || null,
      });

      if (res.ok && res.lead) {
        setQueue((prev) => [res.lead!, ...prev]);
        setIsAddingLead(false);
        setNewName("");
        setNewPhone("");
        setNewContactName("");
        setNewContactTitle("");
        setNewEmail("");
        setNewWebsite("");
        setNewCity("");
        setNewFollowUp("");
        setNewNotes("");
        showToast(`Added ${res.lead.name} to your CRM.`);
      } else {
        showToast(res.error || "Failed to create lead");
      }
    });
  };

  // Filtered queue (respects both Caller Filter and Pipeline Stage Filter)
  const activeQueue = queue.filter((l) => l.status !== "REJECTED");
  const callerScopedQueue = activeQueue.filter((lead) => {
    if (callerFilter === "ALL") return true;
    if (callerFilter === "UNASSIGNED") return !lead.assignedMemberId;
    return lead.assignedMemberId === callerFilter;
  });

  const filteredQueue = queue.filter((lead) => {
    if (lead.status === "REJECTED" && statusFilter !== "REJECTED") return false;
    if (callerFilter === "UNASSIGNED" && lead.assignedMemberId) return false;
    if (
      callerFilter !== "ALL" &&
      callerFilter !== "UNASSIGNED" &&
      lead.assignedMemberId !== callerFilter
    ) {
      return false;
    }

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
    } else if (statusFilter !== "ALL") {
      if (lead.status !== statusFilter) return false;
    }

    if (dateFilter !== "ALL") {
      const dateInfo = classifyLeadDate(lead);
      if (dateFilter === "TODAY" && dateInfo.category !== "TODAY") return false;
      if (dateFilter === "YESTERDAY" && dateInfo.category !== "YESTERDAY") return false;
      if (dateFilter === "OLDER" && (dateInfo.category === "TODAY" || dateInfo.category === "YESTERDAY")) return false;
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
        const cleanExisting = stripFollowUpTagFromNotes(selectedLead.notes);
        const updatedNotes = cleanExisting
          ? `${cleanExisting}\n[Call ${new Date().toISOString().slice(0, 10)}] ${combinedNotes}`
          : `[Call ${new Date().toISOString().slice(0, 10)}] ${combinedNotes}`;

        setQueue((prev) =>
          prev.map((item) =>
            item.companyId === selectedLead.companyId
              ? {
                  ...item,
                  status: res.nextStatus!,
                  software: confirmedSoftware.trim() || item.software,
                  nextFollowUp: followUpDate || item.nextFollowUp,
                  notes: updatedNotes,
                }
              : item
          )
        );
        setFeedbackMessage({
          type: "success",
          text: "Call outcome and notes saved.",
        });
        setTimeout(() => {
          setSelectedLead(null);
          setFeedbackMessage(null);
        }, 700);
      } else {
        setFeedbackMessage({
          type: "error",
          text: res.error || "Could not save call.",
        });
      }
    });
  };

  // Convert queue to CrmLeadItem format for Sheet View (respecting Caller filter)
  const crmLeadsFromQueue: CrmLeadItem[] = callerScopedQueue.map((l) => ({
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
      linkedinUrl: l.bestContact.linkedinUrl || (l.facts as any)?.["linkedin"] || null,
    },
    replacement: l.replacement,
    financing: l.financing,
    software: l.software,
    facts: l.facts,
    financingObserved: l.financingObserved,
    installSignalObserved: l.installSignalObserved,
    onlineBookingObserved: l.onlineBookingObserved,
    notes: l.notes,
    nextFollowUp: l.nextFollowUp,
    researchSummary: l.researchSummary,
    createdAt: l.createdAt,
    approvedAt: l.approvedAt,
    assignedMemberId: l.assignedMemberId,
    assignedMemberName: l.assignedMemberName,
    marketName: l.marketName,
  }));

  
  // Date Intake Counts
  const { todayCount, yesterdayCount, olderCount } = React.useMemo(() => {
    let today = 0;
    let yesterday = 0;
    let older = 0;
    for (const lead of callerScopedQueue) {
      const info = classifyLeadDate(lead);
      if (info.category === "TODAY") today++;
      else if (info.category === "YESTERDAY") yesterday++;
      else older++;
    }
    return { todayCount: today, yesterdayCount: yesterday, olderCount: older };
  }, [callerScopedQueue]);

  interface LeadDateBatch {
    key: string;
    category: LeadDateCategory;
    title: string;
    formattedDate: string;
    leads: CallerLeadView[];
    toCallCount: number;
    connectedCount: number;
  }

  const groupedDateBatches = React.useMemo<LeadDateBatch[]>(() => {
    const map = new Map<string, LeadDateBatch>();

    for (const lead of filteredQueue) {
      const info = classifyLeadDate(lead);
      let batch = map.get(info.groupKey);
      if (!batch) {
        batch = {
          key: info.groupKey,
          category: info.category,
          title: info.title,
          formattedDate: info.formattedDate,
          leads: [],
          toCallCount: 0,
          connectedCount: 0,
        };
        map.set(info.groupKey, batch);
      }
      batch.leads.push(lead);
      if (["APPROVED", "SYNCED", "CALLING"].includes(lead.status)) {
        batch.toCallCount++;
      }
      if (["CONNECTED", "PAIN_FOUND", "MEETING_BOOKED"].includes(lead.status)) {
        batch.connectedCount++;
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.category === "TODAY") return -1;
      if (b.category === "TODAY") return 1;
      if (a.category === "YESTERDAY") return -1;
      if (b.category === "YESTERDAY") return 1;
      return b.key.localeCompare(a.key);
    });
  }, [filteredQueue]);

  // Counters (scoped by active caller filter so Owner can inspect any caller's exact metrics)
  const totalCount = callerScopedQueue.length;
  const toCallCount = callerScopedQueue.filter((l) =>
    ["APPROVED", "SYNCED", "CALLING"].includes(l.status)
  ).length;
  const connectedCount = callerScopedQueue.filter((l) =>
    ["CONNECTED", "PAIN_FOUND"].includes(l.status)
  ).length;
  const meetingsCount = callerScopedQueue.filter((l) => l.status === "MEETING_BOOKED").length;
  const followUpCount = callerScopedQueue.filter(
    (l) => l.nextFollowUp || (l.notes && l.notes.includes("Follow-up Scheduled"))
  ).length;
  const myLeadsCount = activeQueue.filter(
    (l) => activeMember && l.assignedMemberId === activeMember.id
  ).length;
  const unassignedCount = activeQueue.filter((l) => !l.assignedMemberId).length;
  const teamCallers = allMembers.filter(
    (m) => m.status === "ACTIVE" && m.role !== "VIEWER"
  );

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="rounded-xl border border-zinc-800/80 bg-[#121215] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-[#09090b] px-2.5 py-0.5 text-[11px] text-zinc-200 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {nicheName}
            </span>
            <span className="inline-flex items-center rounded-md border border-zinc-800 bg-[#09090b] px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
              {totalCount} Leads
            </span>
          </div>
          <h1 className="mt-1.5 text-xl font-bold text-white tracking-tight">
            Leads CRM &amp; Calling Pipeline
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Click any stage, qualification field, follow-up button, or edit icon to update records in real time.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center p-0.5 rounded-lg bg-[#09090b] border border-zinc-800 text-xs font-medium">
            <button
              type="button"
              onClick={() => setViewMode("CARDS")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                viewMode === "CARDS"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Caller Cards</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("SHEET")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                viewMode === "SHEET"
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Table View</span>
            </button>
          </div>

          {canEditContacts && marketId && (
            <button
              type="button"
              onClick={() => setIsAddingColumn(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 px-3 py-2 text-xs font-semibold transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Column</span>
            </button>
          )}

          {canEditContacts && marketId && (
            <button
              type="button"
              onClick={() => setIsAddingLead(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-white px-3 py-2 text-xs font-semibold transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Add Lead</span>
            </button>
          )}

          {canImport && (
            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white px-3 py-2 text-xs font-semibold transition shadow-sm"
            >
              <Upload className="w-3.5 h-3.5 text-zinc-400" />
              <span>Import Sheet</span>
            </button>
          )}

          {canManageSettings && unassignedCount > 0 && (
            <button
              type="button"
              onClick={handleAutoDistribute}
              disabled={distributePending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black px-3.5 py-2 text-xs font-bold transition disabled:opacity-50 shadow-sm"
              title={`Distribute ${unassignedCount} unassigned leads evenly among active callers`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {distributePending
                  ? "Distributing..."
                  : `Auto-Assign (${unassignedCount})`}
              </span>
            </button>
          )}

          {canDiscover && (
            <Link
              href="/discover"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white hover:bg-zinc-200 text-black px-3.5 py-2 text-xs font-bold transition shadow-sm"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Find Leads</span>
            </Link>
          )}

          {canExport && (
            <a
              href="/api/export/csv"
              download
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 hover:text-white"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400" />
              <span>Export CSV</span>
            </a>
          )}

          {canEditRules && marketId && (
            <ActiveQualityGateCard
              marketId={marketId}
              marketName={nicheName}
              initialRuleConfig={initialRuleConfig}
              canEditRules={canEditRules}
              compactTriggerOnly={true}
            />
          )}
        </div>
      </div>

      {/* CRM Toast */}
      {crmToast && (
        <div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-xs font-medium text-zinc-200">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>{crmToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setCrmToast(null)}
            className="text-zinc-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Owner Team Callers Overview & Lead Assignment Command Bar */}
      {canManageSettings && teamCallers.length > 0 ? (
        <div className="rounded-xl border border-zinc-800/80 bg-[#121215] p-4 space-y-3.5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-white">
                Team Callers &amp; Lead Distribution
              </span>
              <span className="text-[11px] text-zinc-400">
                Select a caller below to filter their assigned leads and activity
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {callerFilter !== "ALL" && callerFilter !== "UNASSIGNED" && (
                (() => {
                  const filteredCaller = teamCallers.find((c) => c.id === callerFilter);
                  const count = filteredCaller ? activeQueue.filter((l) => l.assignedMemberId === filteredCaller.id).length : 0;
                  if (!filteredCaller || count === 0) return null;
                  return (
                    <button
                      type="button"
                      disabled={distributePending}
                      onClick={() => handleUnassignCallerLeads(filteredCaller.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-semibold px-3 py-1 text-xs transition disabled:opacity-50"
                      title={`Unassign all ${count} leads from ${filteredCaller.name} and return them to the Unassigned Pool`}
                    >
                      <span>Unassign All ({count}) Leads</span>
                    </button>
                  );
                })()
              )}

              {unassignedCount > 0 && (
                <div className="flex items-center gap-1.5 bg-[#09090b] border border-zinc-800 rounded-lg px-2.5 py-1 text-xs">
                  <span className="text-zinc-400">
                    Assign {unassignedCount} Unassigned To:
                  </span>
                  <select
                    value={bulkAssignCallerId}
                    onChange={(e) => setBulkAssignCallerId(e.target.value)}
                    className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs font-semibold text-white focus:outline-none"
                  >
                    <option value="">Select Caller...</option>
                    {teamCallers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({ROLE_PRESETS[c.role]?.shortLabel || c.role})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!bulkAssignCallerId || distributePending}
                    onClick={handleBulkAssignToCaller}
                    className="rounded bg-white hover:bg-zinc-200 disabled:opacity-40 text-black font-bold px-2.5 py-0.5 text-[11px] transition"
                  >
                    Assign All
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
            {/* All Team Leads Card */}
            <button
              type="button"
              onClick={() => setCallerFilter("ALL")}
              className={`rounded-xl border p-3 text-left transition ${
                callerFilter === "ALL"
                  ? "border-white bg-zinc-800/90 shadow-sm"
                  : "border-zinc-800 bg-[#09090b] hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">All Team Leads</span>
                <span className="rounded-full bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                  {activeQueue.length}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[10px] text-zinc-400">
                <span>Unassigned: {unassignedCount}</span>
                <span>&bull;</span>
                <span>Assigned: {activeQueue.length - unassignedCount}</span>
              </div>
            </button>

            {/* Unassigned Pool Card */}
            <button
              type="button"
              onClick={() => setCallerFilter("UNASSIGNED")}
              className={`rounded-xl border p-3 text-left transition ${
                callerFilter === "UNASSIGNED"
                  ? "border-amber-400 bg-amber-500/10 shadow-sm"
                  : "border-zinc-800 bg-[#09090b] hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-300">Unassigned Pool</span>
                <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                  {unassignedCount}
                </span>
              </div>
              <div className="mt-1.5 text-[10px] text-zinc-400">
                Waiting to be assigned to callers
              </div>
            </button>

            {/* Individual Caller Cards */}
            {teamCallers.map((caller) => {
              const cLeads = activeQueue.filter((l) => l.assignedMemberId === caller.id);
              const cConnected = cLeads.filter((l) =>
                ["CONNECTED", "PAIN_FOUND"].includes(l.status)
              ).length;
              const cFollowUps = cLeads.filter((l) => Boolean(l.nextFollowUp)).length;
              const cMeetings = cLeads.filter((l) => l.status === "MEETING_BOOKED").length;
              const isSelected = callerFilter === caller.id;

              return (
                <button
                  key={caller.id}
                  type="button"
                  onClick={() => setCallerFilter(caller.id)}
                  className={`rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? "border-emerald-400 bg-emerald-500/10 shadow-sm"
                      : "border-zinc-800 bg-[#09090b] hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                      <Users className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="truncate">{caller.name}</span>
                    </span>
                    <span className="rounded-full bg-zinc-900 border border-zinc-700 px-2 py-0.5 text-[11px] font-bold text-white shrink-0">
                      {cLeads.length} leads
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                    <span>Connected: <strong className="text-zinc-200">{cConnected}</strong></span>
                    <span>&bull;</span>
                    <span>Follow-Ups: <strong className="text-amber-300">{cFollowUps}</strong></span>
                    <span>&bull;</span>
                    <span>Meetings: <strong className="text-emerald-400">{cMeetings}</strong></span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : activeMember?.role === "CALLER" ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span>{activeMember.name}&apos;s Personal Calling Queue</span>
                <span className="rounded bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  {nicheName}
                </span>
              </div>
              <div className="text-[11px] text-zinc-400">
                Showing only leads assigned directly to your account ({totalCount} assigned leads)
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="rounded-lg bg-[#09090b] border border-zinc-800 px-3 py-1.5 text-zinc-300">
              Ready to Call: <strong className="text-white">{toCallCount}</strong>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-zinc-800 px-3 py-1.5 text-zinc-300">
              Follow-Ups: <strong className="text-amber-300">{followUpCount}</strong>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-zinc-800 px-3 py-1.5 text-zinc-300">
              Connected: <strong className="text-indigo-300">{connectedCount}</strong>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-zinc-800 px-3 py-1.5 text-zinc-300">
              Meetings Booked: <strong className="text-emerald-400">{meetingsCount}</strong>
            </span>
            {canEditRules && marketId && (
              <ActiveQualityGateCard
                marketId={marketId}
                marketName={nicheName}
                initialRuleConfig={initialRuleConfig}
                canEditRules={canEditRules}
                compactTriggerOnly={true}
              />
            )}
          </div>
        </div>
      ) : null}

      {viewMode === "SHEET" ? (
        <CrmLeadSheet
          initialLeads={crmLeadsFromQueue}
          nicheName={nicheName}
          nicheCategory={nicheCategory}
          customColumns={customColumns}
          onOpenAddColumn={() => setIsAddingColumn(true)}
          onDeleteCustomColumn={handleDeleteCustomColumn}
          allMembers={allMembers}
          canManageSettings={canManageSettings}
          isOwner={isOwner}
          embedded={true}
          title={`${nicheName} Leads CRM`}
          subtitle="Click any stage, qualification column, follow-up, or lead row to edit details inline."
          showCallerLink={false}
          dialerConfig={dialerConfig}
          permissions={permissions}
          activeActorName={activeActorName}
          onLeadUpdated={(updated) => {
            setQueue((prev) =>
              prev.map((item) =>
                item.companyId === updated.id
                  ? {
                      ...item,
                      name: updated.name,
                      phone: updated.phoneDisplay ?? item.phone,
                      website: updated.website ?? item.website,
                      city: updated.city ?? item.city,
                      state: updated.state ?? item.state,
                      status: (updated.status as LifecycleStatus) || item.status,
                      nextFollowUp: updated.nextFollowUp ?? null,
                      notes: updated.notes ?? item.notes,
                      facts: updated.facts ?? item.facts,
                      assignedMemberId:
                        updated.assignedMemberId !== undefined
                          ? updated.assignedMemberId
                          : item.assignedMemberId,
                      assignedMemberName:
                        updated.assignedMemberName !== undefined
                          ? updated.assignedMemberName
                          : item.assignedMemberName,
                      bestContact: {
                        ...item.bestContact,
                        name: updated.bestContact?.name ?? item.bestContact.name,
                        title: updated.bestContact?.title ?? item.bestContact.title,
                        phone: updated.bestContact?.phone ?? item.bestContact.phone,
                        email: updated.bestContact?.email ?? item.bestContact.email,
                      },
                    }
                  : item
              )
            );
          }}
          onLeadDeleted={(companyId) => {
            setQueue((prev) => prev.filter((item) => item.companyId !== companyId));
          }}
        />
      ) : (
        <div className="space-y-4">

          {/* Date Intake Batch Tabs (Breaks today's vs yesterday's vs older leads) */}
          <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-xl bg-[#121215] border border-zinc-800 text-xs font-semibold">
            <span className="px-2 text-[11px] uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-zinc-400" />
              <span>Intake Date:</span>
            </span>
            <button
              type="button"
              onClick={() => setDateFilter("ALL")}
              className={`px-3 py-1.5 rounded-lg transition ${
                dateFilter === "ALL"
                  ? "bg-white text-black shadow-sm font-bold"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              All Intake Batches ({callerScopedQueue.length})
            </button>
            <button
              type="button"
              onClick={() => setDateFilter("TODAY")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                dateFilter === "TODAY"
                  ? "bg-emerald-500 text-black shadow-sm font-bold"
                  : "text-zinc-400 hover:text-emerald-300"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Today&apos;s Fresh Batch ({todayCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setDateFilter("YESTERDAY")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                dateFilter === "YESTERDAY"
                  ? "bg-amber-400 text-black shadow-sm font-bold"
                  : "text-zinc-400 hover:text-amber-300"
              }`}
            >
              <span>Yesterday&apos;s Batch ({yesterdayCount})</span>
            </button>
            {olderCount > 0 && (
              <button
                type="button"
                onClick={() => setDateFilter("OLDER")}
                className={`px-3 py-1.5 rounded-lg transition ${
                  dateFilter === "OLDER"
                    ? "bg-zinc-800 text-white shadow-sm font-bold"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Earlier Archive ({olderCount})
              </button>
            )}
          </div>

          {/* Pipeline Tabs and Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-[#121215] p-3.5">
            <div className="flex flex-wrap items-center gap-1">
              {[
                { key: "TO_CALL", label: `Ready to Call (${toCallCount})` },
                { key: "MY_LEADS", label: `My Assigned Leads (${myLeadsCount})` },
                { key: "FOLLOW_UP", label: `Scheduled Follow-Ups (${followUpCount})` },
                { key: "CONNECTED", label: `Connected (${connectedCount})` },
                { key: "MEETINGS", label: `Meetings Booked (${meetingsCount})` },
                { key: "ALL", label: `All CRM Leads (${totalCount})` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    statusFilter === tab.key
                      ? "bg-white text-black shadow-sm"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleToggleExpandAllNotes}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-[#09090b] hover:bg-zinc-900 text-xs text-zinc-300 hover:text-white font-medium transition"
                title="Expand or collapse all lead notes & battlecards"
              >
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                <span>{expandAllNotes ? "Collapse Notes" : "Expand All Notes"}</span>
              </button>

              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search company, contact, phone, notes..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-[#09090b] pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Lead Cards List */}
          {filteredQueue.length === 0 ? (
            <div className="p-12 text-center rounded-xl border border-zinc-800/80 bg-[#121215] text-zinc-400 space-y-3">
              <PhoneCall className="w-7 h-7 text-zinc-600 mx-auto" />
              <p className="text-sm font-semibold text-zinc-200">
                No leads in this pipeline filter
              </p>
              <p className="text-xs max-w-md mx-auto">
                Switch pipeline tabs above (such as &ldquo;All CRM Leads&rdquo; or &ldquo;Ready to Call&rdquo;) or add a new lead to get started.
              </p>
              {totalCount > 0 && statusFilter !== "ALL" && (
                <button
                  type="button"
                  onClick={() => setStatusFilter("ALL")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white text-black px-3.5 py-1.5 text-xs font-bold hover:bg-zinc-200 transition"
                >
                  View All {totalCount} CRM Leads
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {groupedDateBatches.map((batch) => {
                const isCollapsed = Boolean(collapsedDateGroups[batch.key]);
                return (
                  <div key={batch.key} className="space-y-3.5">
                    {/* Day Break Banner */}
                    <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl border border-zinc-700/80 bg-[#0e0e12]/95 backdrop-blur-md shadow-md">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${
                            batch.category === "TODAY"
                              ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                              : batch.category === "YESTERDAY"
                              ? "bg-amber-500/15 border border-amber-500/30 text-amber-300"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-xs sm:text-sm font-bold text-white tracking-tight">
                              {batch.title}
                            </h3>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                batch.category === "TODAY"
                                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                  : batch.category === "YESTERDAY"
                                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                  : "bg-zinc-800 text-zinc-300"
                              }`}
                            >
                              {batch.leads.length} {batch.leads.length === 1 ? "Lead" : "Leads"}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-400">
                            {batch.formattedDate} &bull; <strong className="text-zinc-200">{batch.toCallCount}</strong> to call &bull; <strong className="text-emerald-400">{batch.connectedCount}</strong> connected
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleCollapseDateGroup(batch.key)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-zinc-800 bg-[#09090b] hover:bg-zinc-900 text-xs text-zinc-400 hover:text-white transition"
                      >
                        <span>{isCollapsed ? "Show Leads" : "Collapse Batch"}</span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform duration-200 ${
                            isCollapsed ? "-rotate-90" : "rotate-0"
                          }`}
                        />
                      </button>
                    </div>

                    {/* Leads list for this day */}
                    {!isCollapsed && (
                      <div className="space-y-3.5">
                        {batch.leads.map((lead) => {
                const dialPhone = lead.bestContact.phone || lead.phone;
                const dmName = lead.bestContact.name;
                const dmTitle = lead.bestContact.title;
                const dmEmail = lead.bestContact.email;
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${lead.name} ${lead.address || ""} ${lead.city || ""} ${lead.state || ""}`
                )}`;
                const followUpInfo = formatFollowUpLabel(lead.nextFollowUp);
                const cleanNotes = stripFollowUpTagFromNotes(lead.notes);

                const scriptText = getSmartOpeningScript({
                  companyName: lead.name,
                  contactName: dmName,
                  city: lead.city,
                  state: lead.state,
                  nicheName: lead.marketName || nicheName,
                  cleanNotes,
                  researchSummary: lead.researchSummary,
                });

                return (
                  <div
                    key={lead.companyId}
                    className="rounded-xl border border-zinc-800/80 bg-[#121215] p-5 space-y-4 transition hover:border-zinc-700"
                  >
                    {/* Top Row: Company Info, Interactive Pipeline Stage & Edit Button */}
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800/80 pb-3">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h2 className="text-base font-bold text-white tracking-tight">
                            {lead.name}
                          </h2>

                          {lead.marketName && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-[#09090b] px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              {lead.marketName}
                            </span>
                          )}

                          {/* 1-Click Inline Pipeline Stage Dropdown with Vivid Badges */}
                          {canEditContacts ? (
                            <select
                              value={lead.status}
                              onChange={(e) =>
                                handleQuickStatusChange(
                                  lead,
                                  e.target.value as LifecycleStatus
                                )
                              }
                              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold focus:outline-none cursor-pointer transition ${
                                CRM_STAGE_OPTIONS.find((s) => s.value === lead.status)?.badgeClass ||
                                "border-zinc-700 bg-[#09090b] text-zinc-100"
                              }`}
                              title="Change pipeline stage"
                            >
                              {CRM_STAGE_OPTIONS.map((st) => (
                                <option key={st.value} value={st.value} className="bg-[#121215] text-zinc-200">
                                  {st.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-zinc-200">
                              {lead.status}
                            </span>
                          )}

                          {/* Lead Intake Time Badge */}
                          {(() => {
                            const dateInfo = classifyLeadDate(lead);
                            return (
                              <div className="inline-flex items-center gap-1">
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                                    dateInfo.category === "TODAY"
                                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                                      : dateInfo.category === "YESTERDAY"
                                      ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                                      : "border-zinc-800 bg-[#09090b] text-zinc-400"
                                  }`}
                                  title={`Intake Date: ${dateInfo.formattedDate} at ${dateInfo.timeString}`}
                                >
                                  <Clock className="w-3.5 h-3.5 text-zinc-400" />
                                  <span>{dateInfo.shortBadge}</span>
                                </span>
                              </div>
                            );
                          })()}

                          {/* Interactive Follow-Up Pill right in the header */}
                          {lead.nextFollowUp ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => canEditContacts && openFollowUpModal(lead)}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                                  followUpInfo.isOverdue
                                    ? "border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
                                    : "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                                }`}
                                title="Click to reschedule or update follow-up"
                              >
                                <Calendar className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {followUpInfo.isOverdue ? "Overdue: " : "Follow-Up: "}
                                  {followUpInfo.text}
                                </span>
                              </button>
                            </div>
                          ) : (
                            canEditContacts && (
                              <button
                                type="button"
                                onClick={() => openFollowUpModal(lead)}
                                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-zinc-700 bg-[#09090b] hover:bg-zinc-900 hover:border-zinc-600 px-2.5 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition"
                              >
                                <Calendar className="w-3 h-3 text-amber-400" />
                                <span>+ Schedule Follow-Up</span>
                              </button>
                            )
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                          <span className="flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5 text-zinc-500" />
                            <span>
                              {lead.city ? `${lead.city}, ${lead.state}` : lead.state || "US"}
                            </span>
                          </span>

                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-400 hover:text-white flex items-center gap-1"
                          >
                            <MapPin className="w-3 h-3" />
                            <span>Google Maps</span>
                          </a>

                          {lead.website && (
                            <a
                              href={lead.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-400 hover:text-white flex items-center gap-1"
                            >
                              <span>
                                {lead.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                              </span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}

                          {dmEmail && (
                            <a
                              href={`mailto:${dmEmail}`}
                              className="text-zinc-400 hover:text-white flex items-center gap-1"
                            >
                              <Mail className="w-3 h-3" />
                              <span>{dmEmail}</span>
                            </a>
                          )}
                        </div>

                        {/* Assigned Caller: Only visible to Owner / Lead Managers */}
                        {canManageSettings && (
                          <div className="flex flex-wrap items-center gap-3 pt-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-zinc-500 flex items-center gap-1">
                                <Users className="w-3 h-3 text-zinc-500" />
                                <span>Assigned Caller:</span>
                              </span>
                              {allMembers && allMembers.length > 0 ? (
                                <select
                                  value={lead.assignedMemberId || ""}
                                  onChange={(e) =>
                                    handleAssignLead(lead.companyId, e.target.value)
                                  }
                                  disabled={assignPendingId === lead.companyId}
                                  className="rounded border border-zinc-800 bg-[#09090b] px-2 py-0.5 text-[11px] text-zinc-200 focus:border-zinc-500 focus:outline-none cursor-pointer"
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
                                <span className="text-[11px] font-medium text-zinc-300">
                                  {lead.assignedMemberName || "Unassigned"}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Bleeding Ad Spend & Real Estate Scale Badges */}
                        {(lead.facts?.["bleeding_ads"] === "YES" ||
                          lead.facts?.["google_ads"] === "YES" ||
                          lead.facts?.["zillow_advertiser"] === "YES" ||
                          lead.facts?.["doors_managed"] ||
                          lead.facts?.["avg_property_value"] ||
                          lead.facts?.["luxury_high_value"] === "YES") && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            {(lead.facts?.["bleeding_ads"] === "YES" || lead.facts?.["google_ads"] === "YES" || lead.facts?.["zillow_advertiser"] === "YES") && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
                                <span>🔥</span>
                                <span>
                                  {lead.facts?.["google_ads"] === "YES" && lead.facts?.["zillow_advertiser"] === "YES"
                                    ? "Bleeding Ads: Google + Zillow"
                                    : lead.facts?.["google_ads"] === "YES"
                                    ? "Bleeding Ads: Google Ads Active"
                                    : "Bleeding Ads: Zillow Premier"}
                                </span>
                              </span>
                            )}
                            {lead.facts?.["doors_managed"] && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
                                <span>🏢</span>
                                <span>{lead.facts["doors_managed"]} Units/Doors Managed</span>
                              </span>
                            )}
                            {(lead.facts?.["avg_property_value"] || lead.facts?.["luxury_high_value"] === "YES") && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                                <span>🏡</span>
                                <span>{lead.facts?.["avg_property_value"] || "$400k+ High-Ticket Deals"}</span>
                              </span>
                            )}
                          </div>
                        )}

                      </div>

                      <div className="flex items-center gap-2">
                        {canEditContacts && (
                          <button
                            type="button"
                            onClick={() => openEditModal(lead)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-[#09090b] hover:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white transition"
                            title="Edit Company, Contact, Phone, or Notes"
                          >
                            <Pencil className="w-3.5 h-3.5 text-zinc-400" />
                            <span>Edit Lead</span>
                          </button>
                        )}
                        <div className="text-right pl-2 border-l border-zinc-800">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                            ICP Fit
                          </div>
                          <div className="text-sm font-bold text-emerald-400">
                            {lead.icpScore}/100
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Calling Bar */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-xl border border-zinc-800 bg-[#09090b] p-4 items-center">
                      <button
                        type="button"
                        onClick={() => canEditContacts && openEditModal(lead)}
                        className="text-left group"
                        title="Click to edit Decision Maker name or title"
                      >
                        <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                          <span>Decision Maker / Contact</span>
                          {canEditContacts && (
                            <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 text-zinc-400 transition" />
                          )}
                        </div>
                        <div className="font-semibold text-sm text-white mt-0.5 group-hover:underline">
                          {dmName || "Owner / Managing Director"}
                        </div>
                        <div className="text-xs text-zinc-400">
                          {dmTitle || "Verified Business Contact"}
                        </div>
                      </button>

                      <div className="flex flex-col items-start md:items-center">
                        <div className="text-[11px] text-zinc-500 mb-1">Direct Phone Number</div>
                        {dialPhone ? (
                          <button
                            type="button"
                            onClick={() => copyToClipboard(dialPhone, lead.companyId)}
                            className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 hover:border-emerald-500/40 transition cursor-pointer text-left"
                            title="Click to copy phone number to clipboard"
                          >
                            <span className="font-mono font-bold text-base text-emerald-400 group-hover:text-emerald-300">
                              {dialPhone}
                            </span>
                            {copiedId === lead.companyId ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-sans font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span>Copied!</span>
                              </span>
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-zinc-500 group-hover:text-emerald-400 transition" />
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => canEditContacts && openEditModal(lead)}
                            className="text-xs text-zinc-400 hover:text-white underline"
                          >
                            + Add Phone Number
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-start md:justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openLogCallModal(lead)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-white hover:bg-zinc-200 px-4 py-2 text-xs font-bold text-black transition"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          <span>Log Call &amp; Outcome</span>
                        </button>
                      </div>
                    </div>

                    {/* Niche-Specific Smart Qualification Fields & Custom Columns */}
                    <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-[#09090b]/80 p-3.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                          {nicheName} Qualification Profile (Click any field to update)
                        </span>
                        {canEditContacts && marketId && (
                          <button
                            type="button"
                            onClick={() => setIsAddingColumn(true)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add Custom Field</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                        {smartFields.map((field) => {
                          const currentVal = resolveSmartFieldValue(lead, field);
                          const isPositive =
                            currentVal.includes("Confirmed") ||
                            currentVal.includes("Active") ||
                            (currentVal !== "Ask on Call" && currentVal !== "Verify on Call");
                          const allOpts = field.options.includes(currentVal)
                            ? field.options
                            : [currentVal, ...field.options];

                          return (
                            <div
                              key={field.key}
                              className="rounded-lg border border-zinc-800/90 bg-[#121215] p-2.5 flex flex-col justify-between gap-1"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 truncate">
                                  {field.label}
                                </span>
                                {field.isCustom && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteCustomColumn(field.key)}
                                    className="text-zinc-500 hover:text-rose-400 transition"
                                    title={`Remove custom field "${field.label}"`}
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              {canEditContacts ? (
                                <select
                                  value={currentVal}
                                  onChange={(e) =>
                                    handleSmartFieldChange(lead, field, e.target.value)
                                  }
                                  className={`w-full rounded-md border px-2 py-1 text-xs font-semibold focus:outline-none cursor-pointer transition ${
                                    isPositive
                                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                      : "border-zinc-800 bg-[#09090b] text-zinc-300 hover:border-zinc-700"
                                  }`}
                                >
                                  {allOpts.map((opt) => (
                                    <option
                                      key={opt}
                                      value={opt}
                                      className="bg-[#121215] text-white"
                                    >
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-xs font-semibold text-zinc-200">
                                  {currentVal}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Section 1: AI Opening Script & Tailored Battlecard */}
                    <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/10 p-4 text-xs space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-500/20 pb-2">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
                          <span className="font-bold text-indigo-200 text-xs">
                            AI Opening Script &amp; Pitch Strategy
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(scriptText, `script_${lead.companyId}`)}
                            className="text-[11px] font-semibold text-indigo-300 hover:text-white flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 transition"
                          >
                            {copiedId === `script_${lead.companyId}` ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy Script</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* 15-second opening script */}
                      <div className="p-3 rounded-lg bg-[#09090b]/80 border border-indigo-500/20 text-indigo-100 text-xs leading-relaxed font-sans select-text">
                        &ldquo;{scriptText}&rdquo;
                      </div>

                      {/* If AI research summary exists, allow expanding full intelligence */}
                      {lead.researchSummary && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedScriptId(
                                expandedScriptId === lead.companyId ? null : lead.companyId
                              )
                            }
                            className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                          >
                            {expandedScriptId === lead.companyId ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                            <span>
                              {expandedScriptId === lead.companyId
                                ? "Hide AI Intelligence & Signals"
                                : "View Full AI Intelligence & Signals"}
                            </span>
                          </button>
                          {expandedScriptId === lead.companyId && (
                            <div className="mt-2 p-3 rounded-lg bg-[#09090b] border border-zinc-800 text-zinc-300 text-xs leading-relaxed font-sans select-text whitespace-pre-wrap max-h-60 overflow-y-auto">
                              {lead.researchSummary}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Section 2: Caller Log History (Human Call Logs) */}
                    {(() => {
                      const isNotesExpanded = expandAllNotes || Boolean(expandedNotesIds[lead.companyId]);
                      const noteLines = cleanNotes ? cleanNotes.split("\n").filter((l) => l.trim().length > 0) : [];
                      const isMultiLine = noteLines.length > 2 || (cleanNotes && cleanNotes.length > 120);

                      return (
                        <div className="rounded-xl border border-zinc-800/80 bg-[#09090b]/80 p-4 text-xs space-y-3 shadow-inner">
                          {/* Header row of the caller notes box */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                              <span className="font-bold text-zinc-100 text-xs">
                                Caller Log History &amp; CRM Notes
                              </span>
                              {cleanNotes && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 font-semibold border border-zinc-700/60">
                                  {noteLines.length} {noteLines.length === 1 ? "log" : "logs"}
                                </span>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              {cleanNotes && isMultiLine && (
                                <button
                                  type="button"
                                  onClick={() => toggleNotesExpanded(lead.companyId)}
                                  className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition"
                                >
                                  {isNotesExpanded ? (
                                    <>
                                      <ChevronUp className="w-3.5 h-3.5" />
                                      <span>Collapse</span>
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="w-3.5 h-3.5" />
                                      <span>View All ({noteLines.length})</span>
                                    </>
                                  )}
                                </button>
                              )}

                              {cleanNotes && (
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(cleanNotes, `notes_${lead.companyId}`)}
                                  className="text-[11px] font-semibold text-zinc-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition"
                                  title="Copy call notes to clipboard"
                                >
                                  {copiedId === `notes_${lead.companyId}` ? (
                                    <>
                                      <Check className="w-3 h-3 text-emerald-400" />
                                      <span className="text-emerald-400">Copied</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3 h-3" />
                                      <span>Copy Notes</span>
                                    </>
                                  )}
                                </button>
                              )}

                              {canEditContacts && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openFollowUpModal(lead)}
                                    className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 transition"
                                  >
                                    <Clock className="w-3 h-3" />
                                    <span>{lead.nextFollowUp ? "Reschedule" : "Set Follow-Up"}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEditModal(lead)}
                                    className="text-[11px] font-semibold text-zinc-300 hover:text-white flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition"
                                  >
                                    <Pencil className="w-3 h-3" />
                                    <span>{cleanNotes ? "Edit Notes" : "+ Add Note"}</span>
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Notes Body */}
                          {cleanNotes ? (
                            isNotesExpanded || !isMultiLine ? (
                              <div className="p-3.5 rounded-lg bg-zinc-950/90 border border-zinc-800 text-zinc-200 text-xs leading-relaxed whitespace-pre-wrap select-text max-h-72 overflow-y-auto font-sans shadow-inner space-y-1.5">
                                {cleanNotes}
                              </div>
                            ) : (
                              <div
                                onClick={() => toggleNotesExpanded(lead.companyId)}
                                className="p-3 rounded-lg bg-zinc-950/50 border border-zinc-800/80 text-zinc-300 text-xs leading-relaxed cursor-pointer hover:border-zinc-700 hover:text-white transition group space-y-1"
                                title="Click to view all call logs"
                              >
                                <div className="line-clamp-3 select-text font-sans whitespace-pre-wrap">
                                  {cleanNotes}
                                </div>
                                <div className="pt-1 text-[11px] font-semibold text-emerald-400 group-hover:underline flex items-center gap-1">
                                  <span>View all {noteLines.length} call logs...</span>
                                  <ChevronDown className="w-3 h-3" />
                                </div>
                              </div>
                            )
                          ) : (
                            <div className="text-xs text-zinc-500 italic py-1 flex items-center justify-between">
                              <span>No call notes logged yet. Click &ldquo;Log Call & Outcome&rdquo; above to record your call.</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
                  Choose a 1-click preset or pick a custom callback date and time.
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
                  1-Click Quick Presets
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
                  Exact Callback Date &amp; Time
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
                  Follow-Up Note / Reminder (Optional)
                </label>
                <input
                  type="text"
                  value={followUpNote}
                  onChange={(e) => setFollowUpNote(e.target.value)}
                  placeholder="e.g. Decision maker asked to call back Tuesday morning..."
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                />
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
                {followUpTarget.nextFollowUp ? (
                  <button
                    type="button"
                    onClick={() => handleSaveFollowUp(null)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-semibold text-zinc-300 hover:text-white transition"
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
                <h3 className="text-sm font-bold text-white">
                  Edit CRM Lead: {editingLead.name}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Update company details, decision maker, phone, stage, follow-up, or notes.
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
                    placeholder="e.g. Sarah Jenkins"
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
                    placeholder="e.g. Owner, Managing Partner"
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-zinc-300">
                      Next Follow-Up
                    </label>
                    {editFollowUp && (
                      <button
                        type="button"
                        onClick={() => setEditFollowUp("")}
                        className="text-[11px] text-amber-400 hover:underline"
                      >
                        Clear
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

                {canManageSettings && allMembers.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1">
                      Assigned Caller
                    </label>
                    <select
                      value={editAssignedId}
                      onChange={(e) => setEditAssignedId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
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
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  CRM Notes &amp; Call History
                </label>
                <textarea
                  rows={4}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Write notes about this lead, conversation takeaways, or objections..."
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
                {(isOwner || canManageSettings) ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteLead(editingLead.companyId, editingLead.name)}
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
                    {isPending ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Manual Lead to CRM Modal */}
      {isAddingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Add New Lead to CRM ({nicheName})
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Manually add a company and decision maker directly into your calling pipeline.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddingLead(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateManualLead} className="p-6 space-y-3.5 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Company Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Apex Premier Group"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Direct Phone Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="(555) 234-5678"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Decision Maker Name
                  </label>
                  <input
                    type="text"
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    placeholder="e.g. David Reynolds"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Job Title
                  </label>
                  <input
                    type="text"
                    value={newContactTitle}
                    onChange={(e) => setNewContactTitle(e.target.value)}
                    placeholder="e.g. Owner / Founder"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="contact@company.com"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Website URL
                  </label>
                  <input
                    type="text"
                    value={newWebsite}
                    onChange={(e) => setNewWebsite(e.target.value)}
                    placeholder="https://company.com"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">City</label>
                  <input
                    type="text"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    placeholder="Dallas"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">State</label>
                  <input
                    type="text"
                    value={newState}
                    onChange={(e) => setNewState(e.target.value)}
                    placeholder="TX"
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Follow-Up (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={newFollowUp}
                    onChange={(e) => setNewFollowUp(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white focus:border-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Initial Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Any context or notes for calling this prospect..."
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddingLead(false)}
                  className="px-4 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black font-bold text-xs transition"
                >
                  {isPending ? "Adding Lead..." : "Add Lead to CRM"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Call Outcome & Follow-Up Modal */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Log Call &amp; Follow-Up: {selectedLead.name}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {selectedLead.bestContact.name || "Owner/Manager"} &bull;{" "}
                  {selectedLead.bestContact.phone || selectedLead.phone || "No phone"}
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
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Schedule Next Follow-Up (Optional)
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[
                      { label: "Tomorrow", preset: "TOMORROW" as const },
                      { label: "+2 Days", preset: "TWO_DAYS" as const },
                      { label: "Next Week", preset: "NEXT_WEEK" as const },
                    ].map((p) => (
                      <button
                        key={p.preset}
                        type="button"
                        onClick={() => setFollowUpDate(buildPresetFollowUpIso(p.preset))}
                        className="rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-amber-300 transition"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
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
                  placeholder="Write a brief summary of the conversation, objections, or next steps..."
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-xs text-zinc-400 hover:text-white flex items-center gap-1"
                >
                  {showAdvanced ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {showAdvanced
                      ? "Hide extra fields"
                      : "Add current CRM/software or team size"}
                  </span>
                </button>

                {showAdvanced && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5 p-3 rounded-lg bg-[#09090b] border border-zinc-800">
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                        Software / Tools Used
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. HubSpot, Salesforce, Follow Up Boss"
                        value={confirmedSoftware}
                        onChange={(e) => setConfirmedSoftware(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                        Team Size / Agents
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="500"
                        placeholder="e.g. 15"
                        value={confirmedFleet}
                        onChange={(e) => setConfirmedFleet(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white"
                      />
                    </div>
                  </div>
                )}
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
                  {isPending ? "Saving..." : "Save Call Outcome"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Custom CRM Column Modal */}
      {isAddingColumn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#121215] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-400" />
                  <span>Add Custom CRM Field / Column ({nicheName})</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Create a custom qualification column for all leads in {nicheName}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddingColumn(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomColumn} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Field / Column Name *
                </label>
                <input
                  type="text"
                  required
                  value={newColumnLabel}
                  onChange={(e) => setNewColumnLabel(e.target.value)}
                  placeholder="e.g. Monthly Ad Spend, Service Area, Roof Age, Deal Size"
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Dropdown Options (Comma-separated)
                </label>
                <input
                  type="text"
                  value={newColumnOptions}
                  onChange={(e) => setNewColumnOptions(e.target.value)}
                  placeholder="e.g. Confirmed, Yes, No, Ask on Call"
                  className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Callers will be able to select any of these options in 1 click on both Cards and Table View.
                </p>
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddingColumn(false)}
                  className="px-4 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-zinc-200 text-black font-bold text-xs transition"
                >
                  {isPending ? "Adding..." : "Add Column to CRM"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk CSV / Sheet Import Modal */}
      <LeadImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImportSuccess={() => {
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }}
      />
    </div>
  );
}
