"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CallerLeadView } from "@/server/repo/caller";
import {
  logCallFeedbackAction,
  assignLeadAction,
  autoDistributeLeadsAction,
  updateLeadCrmDetailsAction,
  updateLeadStatusQuickAction,
  updateLeadFollowUpAction,
  resetLeadCallStatusAction,
  deleteCallLogEntryAction,
  createManualCrmLeadAction,
  deleteCrmLeadAction,
  updateLeadSmartFieldAction,
  addCustomCrmColumnAction,
  deleteCustomCrmColumnAction,
  assignBulkLeadsToCallerAction,
  unassignCallerLeadsAction,
  saveCallerShiftConfigAction,
} from "./actions";
import { type TeamMember, ROLE_PRESETS } from "@/server/domain/team";
import { switchMarketAction } from "@/app/actions/tenant";
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
import { CallLogModal, type CallLogSubmitData } from "@/components/call-log-modal";
import { classifyLeadDate, parseLatestCallerNote, type LeadDateCategory } from "@/components/crm-date-utils";
import {
  CALL_STATUS_DEFS,
  CRM_FILTER_CHIPS,
  STATUS_FILTER_TO_KEY,
  computeLiveCrmTelemetry,
  deriveCallStatus,
  extractFollowUp,
  isFollowUpOverdue,
  type CallOutcomeKey,
  type CallStatusKey,
} from "@/server/domain/call-outcomes";
import { CallOutcomePicker, CallStatusBadge, CallStatusLegend } from "@/components/call-status-ui";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { MeetingBookingModal } from "@/components/meeting-booking-modal";
import { getLeadEmailStatus } from "@/server/domain/email-templates";
import {
  CallerFocusCockpit,
  type FocusCockpitSubmitPayload,
} from "@/components/caller-focus-cockpit";
import {
  computeAutoFollowUpCadence,
  DEFAULT_CALLER_SHIFT_CONFIG,
  resolveCallerShiftRule,
  computeActiveNightShiftBlock,
  computeCallerShiftSummary,
  resolveEffectiveShiftWeights,
  type CallerShiftConfig,
  type CallerShiftRule,
  type ShiftPacingMode,
} from "@/server/domain/focus-queue";
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
  Zap,
  SlidersHorizontal,
  RotateCcw,
} from "lucide-react";

interface CallerClientProps {
  initialQueue: CallerLeadView[];
  initialCallerFilter?: string;
  /** Pre-selects a status filter, e.g. from Sales Funnel deep links (?status=NO_ANSWER). */
  initialStatusFilter?: string;
  initialTzFilter?: string;
  initialWindowFilter?: string;
  nicheName?: string;
  nicheCategory?: string;
  initialCustomColumns?: CustomCrmColumn[];
  marketId?: string;
  verticalMarkets?: Array<{ id: string; key: string; name: string; count: number }>;
  dialerConfig?: DialerConfig;
  initialShiftConfig?: Partial<CallerShiftConfig>;
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

  // 2. Authoritative Role & Responsibility Verification (Zero pitch upfront, pure diagnostic authority)
  const firstName = contactName ? contactName.trim().split(/\s+/)[0] : null;
  const targetName = firstName || "there";
  const location = [city, state].filter(Boolean).join(", ") || "your area";
  const lowerNiche = (nicheName || "").toLowerCase();

  if (/real estate|property management|realty|realtor|brokerage|leasing/i.test(lowerNiche)) {
    return `Hey ${targetName}, just trying to see — am I connected with the person who oversees property owner acquisitions and after-hours intake at ${companyName}, or did I get the wrong desk?

[Wait for confirmation: "Yeah, this is ${targetName} / That's me, what's this regarding?"]

Got it. ${targetName}, quick question regarding your intake in ${location} — when new property owners or tenant inquiries call after hours or on weekends, who handles that intake live, or does it roll over to voicemail?`;
  }

  if (/hvac|heating|air conditioning|cooling|plumbing|roofing|electric|contractor/i.test(lowerNiche)) {
    return `Hey ${targetName}, just trying to see — am I connected with the person responsible for estimate follow-ups and service dispatch at ${companyName}, or did I get the wrong line?

[Wait for confirmation: "Yeah, this is ${targetName} / That's me, what's this regarding?"]

Got it. ${targetName}, quick question regarding your service operations in ${location} — when replacement bids or emergency service calls come in after 5 PM, who catches that live, or does it hit voicemail until morning?`;
  }

  if (/medical|clinic|healthcare|doctor|physician|dental|dentist|wellness/i.test(lowerNiche)) {
    return `Hey ${targetName}, just trying to see — am I connected with the practice manager responsible for new patient intake at ${companyName}, or did I get the wrong desk?

[Wait for confirmation: "Yeah, this is ${targetName} / That's me, what's this regarding?"]

Got it. ${targetName}, quick question regarding your patient intake in ${location} — when consultation inquiries call in after hours, does someone answer live in under 30 seconds, or does it wait until the front desk opens?`;
  }

  return `Hey ${targetName}, just trying to see — am I connected with the person responsible for client intake and operations at ${companyName}, or did I get the wrong line?

[Wait for confirmation: "Yeah, this is ${targetName} / That's me, what's this regarding?"]

Got it. ${targetName}, quick question regarding your intake in ${location} — when high-intent inquiries call after hours or while your team is busy, who catches those calls live?`;
}

export function CallerClient({
  initialQueue,
  initialCallerFilter = "ALL",
  initialStatusFilter = "ALL",
  initialTzFilter = "ALL",
  initialWindowFilter = "ALL",
  nicheName = "Active Niche",
  nicheCategory,
  initialCustomColumns = [],
  marketId,
  verticalMarkets = [],
  dialerConfig = DEFAULT_DIALER_CONFIG,
  initialShiftConfig,
  activeActorName = "Sales Caller",
  activeMember,
  allMembers = [],
  permissions,
  initialRuleConfig = {},
  canEditRules = false,
}: CallerClientProps) {
  const router = useRouter();
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

  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter || "ALL");
  const [distributePending, startDistribute] = useTransition();
  const [assignPendingId, setAssignPendingId] = useState<string | null>(null);
  const [crmToast, setCrmToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setCrmToast(msg);
    setTimeout(() => setCrmToast(null), 3500);
  };

  const isOwner = Boolean(activeMember && activeMember.role === "OWNER");
  const canDiscover = isOwner || Boolean(permissions?.discoverLeads);
  const canImport = isOwner || Boolean(permissions?.discoverLeads || permissions?.exportAndSync);
  const canExport = isOwner || Boolean(permissions?.exportAndSync);
  const canManageSettings = isOwner || Boolean(permissions?.manageTeamAndSettings);
  const canEditContacts = isOwner || Boolean(permissions?.editContacts);
  const canEditNotes =
    isOwner || Boolean(permissions?.editContacts) || Boolean(permissions?.callerWorkbench);

  // Owner-Controlled Shift Sequence & Multi-Caller Pacing State
  const [shiftConfig, setShiftConfig] = useState<CallerShiftConfig>(() => ({
    defaultRule: {
      ...DEFAULT_CALLER_SHIFT_CONFIG.defaultRule,
      ...(initialShiftConfig?.defaultRule || {}),
    },
    callerOverrides: {
      ...(initialShiftConfig?.callerOverrides || {}),
    },
    updatedAt: initialShiftConfig?.updatedAt,
    updatedBy: initialShiftConfig?.updatedBy,
  }));
  const [shiftPanelOpen, setShiftPanelOpen] = useState(false);
  const [shiftTargetCallerId, setShiftTargetCallerId] = useState<string>("ALL");
  const [shiftDraftRule, setShiftDraftRule] = useState<CallerShiftRule>(() =>
    resolveCallerShiftRule(initialShiftConfig, "ALL")
  );
  const [shiftSavePending, startShiftSave] = useTransition();

  React.useEffect(() => {
    if (!initialShiftConfig) return;
    setShiftConfig({
      defaultRule: {
        ...DEFAULT_CALLER_SHIFT_CONFIG.defaultRule,
        ...(initialShiftConfig.defaultRule || {}),
      },
      callerOverrides: {
        ...(initialShiftConfig.callerOverrides || {}),
      },
      updatedAt: initialShiftConfig.updatedAt,
      updatedBy: initialShiftConfig.updatedBy,
    });
  }, [initialShiftConfig]);

  const viewedShiftCallerId = canManageSettings
    ? callerFilter !== "ALL" && callerFilter !== "UNASSIGNED"
      ? callerFilter
      : null
    : activeMember?.id ?? null;

  const activeShiftRule = React.useMemo(
    () => resolveCallerShiftRule(shiftConfig, viewedShiftCallerId),
    [shiftConfig, viewedShiftCallerId]
  );

  const activeNightBlock = React.useMemo(() => computeActiveNightShiftBlock(), []);
  const activeShiftWeights = React.useMemo(
    () => resolveEffectiveShiftWeights(activeShiftRule),
    [activeShiftRule]
  );

  const selectShiftTarget = (targetId: string) => {
    setShiftTargetCallerId(targetId);
    setShiftDraftRule(resolveCallerShiftRule(shiftConfig, targetId === "ALL" ? null : targetId));
  };

  const handleSaveShiftRule = () => {
    startShiftSave(async () => {
      const res = await saveCallerShiftConfigAction({
        targetCallerId: shiftTargetCallerId,
        ruleUpdate: shiftDraftRule,
      });
      if (res.ok && res.config) {
        setShiftConfig(res.config);
        setShiftDraftRule(
          resolveCallerShiftRule(
            res.config,
            shiftTargetCallerId === "ALL" ? null : shiftTargetCallerId
          )
        );
        const targetLabel =
          shiftTargetCallerId === "ALL"
            ? "All Callers (Workspace Default)"
            : allMembers.find((m) => m.id === shiftTargetCallerId)?.name || "Caller";
        showToast(`Saved shift sequence & daily quotas for ${targetLabel}.`);
      } else {
        showToast(res.error || "Failed to save shift sequence settings");
      }
    });
  };

  const handleResetCallerShiftOverride = (callerId: string) => {
    startShiftSave(async () => {
      const res = await saveCallerShiftConfigAction({
        targetCallerId: callerId,
        ruleUpdate: {},
        resetOverride: true,
      });
      if (res.ok && res.config) {
        setShiftConfig(res.config);
        setShiftDraftRule(resolveCallerShiftRule(res.config, null));
        const targetName = allMembers.find((m) => m.id === callerId)?.name || "Caller";
        showToast(`Reset ${targetName} back to Workspace Default Shift Rule.`);
      } else {
        showToast(res.error || "Failed to reset caller shift override");
      }
    });
  };

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
      if (res.nextStatus || res.updatedNotes !== undefined) {
        setQueue((prev) =>
          prev.map((item) =>
            item.companyId === lead.companyId
              ? {
                  ...item,
                  facts: { ...(item.facts || {}), [field.key]: nextValue },
                  ...(res.nextStatus ? { status: res.nextStatus } : {}),
                  ...(res.updatedNotes !== undefined ? { notes: res.updatedNotes } : {}),
                }
              : item
          )
        );
      }
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
  const [viewMode, setViewMode] = useState<"FOCUS" | "CARDS" | "SHEET">("FOCUS");
  const effectiveViewMode = isOwner ? viewMode : "FOCUS";
  const [visibleCardsCount, setVisibleCardsCount] = useState<number>(50);
  const [dateFilter, setDateFilter] = useState<"ALL" | "TODAY" | "YESTERDAY" | "OLDER">("ALL");
  const [collapsedDateGroups, setCollapsedDateGroups] = useState<Record<string, boolean>>({});

  const toggleCollapseDateGroup = (groupKey: string) => {
    setCollapsedDateGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  React.useEffect(() => {
    try {
      const savedView = localStorage.getItem("astraventa_caller_default_view");
      // Always default to Calling Console on mount so users land straight in the dialing deck
      setViewMode("FOCUS");
      const savedStatus = localStorage.getItem("astraventa_caller_status_filter");
      if (savedStatus && initialStatusFilter === "ALL") {
        if (savedStatus === "TO_CALL" || savedStatus === "UNTOUCHED") {
          const hasUntouched = queue.some((l) => deriveCallStatus(l).key === "UNTOUCHED");
          if (hasUntouched) {
            setStatusFilter(savedStatus);
          } else {
            // When zero untouched leads remain, default to ALL so leads never appear missing
            setStatusFilter("ALL");
            localStorage.removeItem("astraventa_caller_status_filter");
          }
        } else {
          setStatusFilter(savedStatus);
        }
      }
      // Always start with ALL dates and ALL callers visible (unless URL query specified) so stale localStorage never mismatches Dashboard/Analytics
      setDateFilter("ALL");
      localStorage.removeItem("astraventa_caller_date_filter");
      if (!initialCallerFilter || initialCallerFilter === "ALL") {
        setCallerFilter("ALL");
        localStorage.removeItem("astraventa_caller_selected_caller");
      }
    } catch {}
  }, [initialStatusFilter, initialCallerFilter, activeMember?.role]);

  // Real-time background data rotation (syncs queue when server props refresh & polls every 20s when tab is active)
  React.useEffect(() => {
    setQueue(initialQueue);
  }, [initialQueue]);

  React.useEffect(() => {
    const refreshLive = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };
    const interval = setInterval(refreshLive, 20_000);
    window.addEventListener("focus", refreshLive);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refreshLive);
    };
  }, [router]);

  const setViewModeAndPersist = (mode: "FOCUS" | "CARDS" | "SHEET") => {
    if (!isOwner && mode !== "FOCUS") return;
    setViewMode(mode);
    try {
      localStorage.setItem("astraventa_caller_default_view", mode);
    } catch {}
  };

  const setStatusFilterAndPersist = (tabKey: string) => {
    setStatusFilter(tabKey);
    setVisibleCardsCount(50);
    try {
      localStorage.setItem("astraventa_caller_status_filter", tabKey);
    } catch {}
  };

  const setDateFilterAndPersist = (df: "ALL" | "TODAY" | "YESTERDAY" | "OLDER") => {
    setDateFilter(df);
    setVisibleCardsCount(50);
    try {
      localStorage.setItem("astraventa_caller_date_filter", df);
    } catch {}
  };

  const setCallerFilterAndPersist = (callerId: string) => {
    setCallerFilter(callerId);
    setVisibleCardsCount(50);
    try {
      localStorage.setItem("astraventa_caller_selected_caller", callerId);
    } catch {}
  };

  // State for Log Call modal
  const [isPending, startTransition] = useTransition();
  const [actor] = useState(activeActorName);
  const [recentlyDialedIds, setRecentlyDialedIds] = useState<Set<string>>(new Set());

  // Follow-Up Quick Scheduler Modal State
  const [followUpTarget, setFollowUpTarget] = useState<CallerLeadView | null>(null);
  const [followUpInput, setFollowUpInput] = useState<string>("");
  const [followUpNote, setFollowUpNote] = useState<string>("");

  // Outbound Email Modal State
  const [emailModalLead, setEmailModalLead] = useState<CallerLeadView | null>(null);

  // Structured Meeting Booking Modal State
  const [meetingModalLead, setMeetingModalLead] = useState<CallerLeadView | null>(null);

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
      if (res.updatedNotes !== undefined || res.nextStatus !== undefined) {
        setQueue((prev) =>
          prev.map((item) =>
            item.companyId === lead.companyId
              ? {
                  ...item,
                  status: res.nextStatus ?? nextStatus,
                  ...(res.updatedNotes !== undefined ? { notes: res.updatedNotes } : {}),
                }
              : item
          )
        );
      }
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
    setFollowUpInput(lead.nextFollowUp || buildPresetFollowUpIso("TOMORROW", lead.state));
    setFollowUpNote("");
  };

  // Direct Follow-Up Reschedule from Calling Cockpit (never logs a fake call)
  const handleCockpitRescheduleFollowUp = (
    lead: CallerLeadView,
    followUpDate: string | null,
    note?: string
  ) => {
    const targetId = lead.companyId;
    setQueue((prev) =>
      prev.map((item) =>
        item.companyId === targetId
          ? {
              ...item,
              nextFollowUp: followUpDate,
            }
          : item
      )
    );
    showToast(
      followUpDate
        ? `Rescheduled callback for ${lead.name} (${formatFollowUpLabel(followUpDate, lead.state).text}).`
        : `Cleared callback for ${lead.name}.`
    );

    startTransition(async () => {
      const res = await updateLeadFollowUpAction({
        companyId: targetId,
        followUpDate,
        note: note || null,
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
      } else {
        showToast(res.error || "Could not update follow-up");
      }
    });
  };

  const handleSaveFollowUp = (overrideDate?: string | null) => {
    if (!followUpTarget) return;
    const targetId = followUpTarget.companyId;
    const targetName = followUpTarget.name;
    const targetState = followUpTarget.state;
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
            ? `Scheduled follow-up for ${targetName} (${formatFollowUpLabel(dateToSave, targetState).text}).`
            : `Marked follow-up completed for ${targetName}.`
        );
      } else {
        showToast(res.error || "Could not update follow-up");
      }
    });
  };

  const handleEmailSent = (result: { followUpDate: string; updatedNotes: string }) => {
    if (!emailModalLead) return;
    const targetId = emailModalLead.companyId;
    const targetName = emailModalLead.name;
    setQueue((prev) =>
      prev.map((lead) => {
        if (lead.companyId !== targetId) return lead;
        return {
          ...lead,
          nextFollowUp: result.followUpDate,
          nextFollowUpAt: result.followUpDate ? new Date(result.followUpDate) : null,
          notes: result.updatedNotes,
        };
      })
    );
    setEmailModalLead(null);
    showToast(`Email sent to ${targetName}. Follow-up scheduled for ${result.followUpDate}.`);
  };

  const handleMeetingBooked = (result: {
    meetingId: string;
    followUpDate: string;
    updatedNotes: string;
  }) => {
    if (!meetingModalLead) return;
    const targetId = meetingModalLead.companyId;
    const targetName = meetingModalLead.name;
    setQueue((prev) =>
      prev.map((lead) => {
        if (lead.companyId !== targetId) return lead;
        return {
          ...lead,
          status: "MEETING_BOOKED",
          nextFollowUp: result.followUpDate,
          nextFollowUpAt: result.followUpDate ? new Date(result.followUpDate) : null,
          notes: result.updatedNotes,
        };
      })
    );
    setMeetingModalLead(null);
    showToast(`Discovery meeting booked for ${targetName}! Follow-up scheduled for ${result.followUpDate}.`);
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

    const derived = deriveCallStatus(editingLead);
    const isWrongNum = derived.key === "WRONG_NUMBER";
    const phoneChanged = editPhone.trim() !== (editingLead.bestContact?.phone || editingLead.phone || "");
    const shouldResetOutcome = (isWrongNum && phoneChanged) || editStatus === "APPROVED";
    const effectiveStatus: LifecycleStatus = shouldResetOutcome ? "APPROVED" : editStatus;

    const combinedNotes = shouldResetOutcome
      ? editNotes.trim() || null
      : editFollowUp
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
              status: effectiveStatus,
              nextFollowUp: shouldResetOutcome ? null : editFollowUp || null,
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
        status: effectiveStatus,
        contactName: editContactName.trim() || null,
        contactTitle: editContactTitle.trim() || null,
        contactEmail: editEmail.trim() || null,
        contactPhone: editPhone.trim() || null,
        nextFollowUp: shouldResetOutcome ? null : editFollowUp || null,
        notes: editNotes.trim() || null,
        assignedMemberId: editAssignedId || null,
        assignedMemberName: assignedObj?.name || null,
        resetCallOutcome: shouldResetOutcome,
      });

      if (res.ok) {
        if (res.updatedNotes !== undefined || res.nextStatus !== undefined) {
          setQueue((prev) =>
            prev.map((item) =>
              item.companyId === targetId
                ? {
                    ...item,
                    status: (res.nextStatus as LifecycleStatus) || item.status,
                    notes: res.updatedNotes !== undefined ? res.updatedNotes : item.notes,
                  }
                : item
            )
          );
        }
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
    // If not owner/manager, strictly lock queue to the logged-in caller's leads
    if (!canManageSettings && activeMember) {
      return lead.assignedMemberId === activeMember.id;
    }
    if (callerFilter === "ALL") return true;
    if (callerFilter === "UNASSIGNED") return !lead.assignedMemberId;
    return lead.assignedMemberId === callerFilter;
  });

  const filteredQueue = queue.filter((lead) => {
    if (lead.status === "REJECTED" && statusFilter !== "REJECTED") return false;
    if (!canManageSettings && activeMember) {
      if (lead.assignedMemberId !== activeMember.id) return false;
    } else {
      if (callerFilter === "UNASSIGNED" && lead.assignedMemberId) return false;
      if (
        callerFilter !== "ALL" &&
        callerFilter !== "UNASSIGNED" &&
        lead.assignedMemberId !== callerFilter
      ) {
        return false;
      }
    }

    if (statusFilter === "MY_LEADS") {
      if (!activeMember || lead.assignedMemberId !== activeMember.id) return false;
    } else if (statusFilter === "FOLLOW_UP") {
      if (!lead.nextFollowUp && !extractFollowUp(lead.notes))
        return false;
    } else if (statusFilter === "OVERDUE") {
      const fu = lead.nextFollowUp || extractFollowUp(lead.notes);
      if (!fu || !isFollowUpOverdue(fu)) return false;
    } else if (statusFilter === "TO_CALL") {
      const wanted = STATUS_FILTER_TO_KEY["TO_CALL"];
      if (deriveCallStatus(lead).key !== wanted) return false;
    } else if (statusFilter !== "ALL") {
      const wanted = STATUS_FILTER_TO_KEY[statusFilter];
      if (wanted) {
        if (deriveCallStatus(lead).key !== wanted) return false;
      } else if (lead.status !== statusFilter) {
        return false;
      }
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
  };

  const handleLogCallSubmit = (data: CallLogSubmitData) => {
    if (!selectedLead) return;

    const targetLead = selectedLead;
    const chosenOutcome = data.outcome;
    const isTerminal =
      chosenOutcome === "MEETING_BOOKED" ||
      chosenOutcome === "NOT_INTERESTED" ||
      chosenOutcome === "WRONG_NUMBER";
    const explicitDate = (data.followUpDate || "").trim();
    const chosenFollowUp = !isTerminal && explicitDate ? explicitDate : null;
    const chosenSoft = data.softwareConfirmed || null;
    const chosenEmail = data.emailConfirmed ? data.emailConfirmed.trim() : null;
    const fleetNum = data.fleetSizeConfirmed ?? null;
    const rawNoteText = data.callerNotes;
    const combinedNotes = chosenFollowUp
      ? `[Next Follow-up Scheduled: ${chosenFollowUp}] ${rawNoteText}`
      : rawNoteText;

    const outcomeLabel = CALL_STATUS_DEFS[chosenOutcome]?.noteLabel || chosenOutcome;
    const timeStr = new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const optimisticNoteLine = `[${timeStr} • ${actor.trim() || activeActorName} (${outcomeLabel})]: ${
      rawNoteText || `Call outcome recorded: ${outcomeLabel}`
    }`;
    const cleanExisting = stripFollowUpTagFromNotes(targetLead.notes);
    const optimisticNotes = `${
      chosenFollowUp ? `[Next Follow-up Scheduled: ${chosenFollowUp}]\n` : ""
    }${optimisticNoteLine}${cleanExisting ? `\n${cleanExisting}` : ""}`;
    const optimisticStatus: LifecycleStatus =
      chosenOutcome === "MEETING_BOOKED"
        ? "MEETING_BOOKED"
        : chosenOutcome === "CONNECTED"
        ? "CONNECTED"
        : chosenOutcome === "NOT_INTERESTED" || chosenOutcome === "WRONG_NUMBER"
        ? "LOST"
        : "CALLING";

    const nowIso = new Date().toISOString();

    // Mark as recently dialed in current session so it doesn't vanish from view
    setRecentlyDialedIds((prev) => new Set([...prev, targetLead.companyId]));

    // Instant optimistic update + close modal immediately
    setQueue((prev) =>
      prev.map((item) =>
        item.companyId === targetLead.companyId
          ? {
              ...item,
              status: optimisticStatus,
              software: chosenSoft || item.software,
              bestContact: {
                ...item.bestContact,
                email: chosenEmail || item.bestContact?.email || null,
              },
              nextFollowUp: isTerminal ? null : chosenFollowUp || item.nextFollowUp,
              notes: optimisticNotes,
              updatedAt: nowIso,
            }
          : item
      )
    );
    setSelectedLead(null);
    if (chosenOutcome === "MEETING_BOOKED") {
      setMeetingModalLead(targetLead);
    }
    showToast(
      `Call logged for ${targetLead.name} (${outcomeLabel}). ${
        chosenFollowUp ? "Next callback scheduled." : "Lead updated."
      }`
    );

    startTransition(async () => {
      const res = await logCallFeedbackAction({
        companyId: targetLead.companyId,
        actor: actor.trim() || activeActorName,
        callOutcome: chosenOutcome,
        softwareConfirmed: chosenSoft,
        fleetSizeConfirmed: fleetNum,
        emailConfirmed: chosenEmail,
        callerNotes: combinedNotes,
        followUpDate: chosenFollowUp,
        clientLogId: data.clientLogId || null,
      });

      if (res.success && res.nextStatus) {
        setQueue((prev) =>
          prev.map((item) =>
            item.companyId === targetLead.companyId
              ? {
                  ...item,
                  status: res.nextStatus!,
                  software: chosenSoft || item.software,
                  nextFollowUp:
                    res.nextFollowUp !== undefined ? res.nextFollowUp : chosenFollowUp,
                  notes: res.updatedNotes || optimisticNotes,
                  updatedAt: res.updatedAt || nowIso,
                }
              : item
          )
        );
      }
    });
  };

  const handleFocusCockpitSubmit = (payload: FocusCockpitSubmitPayload) => {
    const targetLead = payload.lead;
    const chosenOutcome = payload.outcome;
    const isTerminal =
      chosenOutcome === "MEETING_BOOKED" ||
      chosenOutcome === "NOT_INTERESTED" ||
      chosenOutcome === "WRONG_NUMBER";
    const explicitDate = (payload.followUpDate || "").trim();
    const chosenFollowUp = !isTerminal && explicitDate ? explicitDate : null;
    const chosenSoft = payload.softwareConfirmed || null;
    const fleetNum = payload.fleetSizeConfirmed ?? null;
    const rawNoteText = payload.callerNotes;
    const combinedNotes = chosenFollowUp
      ? `[Next Follow-up Scheduled: ${chosenFollowUp}] ${rawNoteText}`
      : rawNoteText;

    const outcomeLabel = CALL_STATUS_DEFS[chosenOutcome]?.noteLabel || chosenOutcome;
    const timeStr = new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const optimisticNoteLine = `[${timeStr} • ${actor.trim() || activeActorName} (${outcomeLabel})]: ${
      rawNoteText || `Call outcome recorded: ${outcomeLabel}`
    }`;
    const cleanExisting = stripFollowUpTagFromNotes(targetLead.notes);
    const optimisticNotes = `${
      chosenFollowUp ? `[Next Follow-up Scheduled: ${chosenFollowUp}]\n` : ""
    }${optimisticNoteLine}${cleanExisting ? `\n${cleanExisting}` : ""}`;
    const optimisticStatus: LifecycleStatus =
      chosenOutcome === "MEETING_BOOKED"
        ? "MEETING_BOOKED"
        : chosenOutcome === "CONNECTED"
        ? "CONNECTED"
        : chosenOutcome === "NOT_INTERESTED" || chosenOutcome === "WRONG_NUMBER"
        ? "LOST"
        : "CALLING";

    const nowIso = new Date().toISOString();

    setRecentlyDialedIds((prev) => new Set([...prev, targetLead.companyId]));

    setQueue((prev) =>
      prev.map((item) =>
        item.companyId === targetLead.companyId
          ? {
              ...item,
              status: optimisticStatus,
              software: chosenSoft || item.software,
              nextFollowUp:
                isTerminal || payload.clearFollowUp
                  ? null
                  : chosenFollowUp || item.nextFollowUp,
              notes: optimisticNotes,
              updatedAt: nowIso,
            }
          : item
      )
    );

    showToast(
      `✓ ${targetLead.name}: ${outcomeLabel}${
        chosenFollowUp
          ? ` • Callback set (${formatFollowUpLabel(chosenFollowUp, targetLead.state).text})`
          : ""
      }`
    );

    startTransition(async () => {
      const res = await logCallFeedbackAction({
        companyId: targetLead.companyId,
        actor: actor.trim() || activeActorName,
        callOutcome: chosenOutcome,
        softwareConfirmed: chosenSoft,
        fleetSizeConfirmed: fleetNum,
        emailConfirmed: payload.emailConfirmed || null,
        callerNotes: combinedNotes,
        followUpDate: chosenFollowUp,
        clearFollowUp: payload.clearFollowUp || false,
        clientLogId: payload.clientLogId || null,
      });

      if (res.success && res.nextStatus) {
        setQueue((prev) =>
          prev.map((item) =>
            item.companyId === targetLead.companyId
              ? {
                  ...item,
                  status: res.nextStatus!,
                  software: chosenSoft || item.software,
                  nextFollowUp:
                    res.nextFollowUp !== undefined ? res.nextFollowUp : chosenFollowUp,
                  notes: res.updatedNotes || optimisticNotes,
                  updatedAt: res.updatedAt || nowIso,
                }
              : item
          )
        );
        if (res.autoRescheduleReason && res.nextFollowUp) {
          showToast(
            `✓ ${targetLead.name}: ${res.autoRescheduleReason} (${formatFollowUpLabel(res.nextFollowUp, targetLead.state).text})`
          );
        }
      }
    });
  };

  const handleResetLead = (targetLead: CallerLeadView) => {
    const timeStr = new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const resetLine = `[${timeStr} • ${actor.trim() || activeActorName} (Ready to Call)]: Lead outcome reset to Ready to Call`;
    const cleanExisting = stripFollowUpTagFromNotes(targetLead.notes);
    const optimisticNotes = `${resetLine}${cleanExisting ? `\n${cleanExisting}` : ""}`;
    const nowIso = new Date().toISOString();

    setQueue((prev) =>
      prev.map((item) =>
        item.companyId === targetLead.companyId
          ? {
              ...item,
              status: "APPROVED",
              nextFollowUp: null,
              notes: optimisticNotes,
              updatedAt: nowIso,
            }
          : item
      )
    );
    showToast(`✓ Reset ${targetLead.name} back to Ready to Call.`);

    startTransition(async () => {
      const res = await resetLeadCallStatusAction({
        companyId: targetLead.companyId,
        clearFollowUp: true,
        reason: "Lead outcome reset to Ready to Call",
      });
      if (res.ok) {
        setQueue((prev) =>
          prev.map((item) =>
            item.companyId === targetLead.companyId
              ? {
                  ...item,
                  status: (res.nextStatus as LifecycleStatus) || "APPROVED",
                  nextFollowUp: null,
                  notes: res.updatedNotes ?? optimisticNotes,
                  updatedAt: nowIso,
                }
              : item
          )
        );
      } else {
        showToast(res.error || "Failed to reset lead");
      }
    });
  };

  const handleDeleteCallLogEntry = (targetLead: CallerLeadView, logIndex: number) => {
    startTransition(async () => {
      const res = await deleteCallLogEntryAction({
        companyId: targetLead.companyId,
        logIndex,
      });
      if (res.ok) {
        setQueue((prev) =>
          prev.map((item) =>
            item.companyId === targetLead.companyId
              ? {
                  ...item,
                  status: (res.nextStatus as LifecycleStatus) || item.status,
                  notes: res.updatedNotes ?? item.notes,
                  nextFollowUp:
                    res.nextStatus === "APPROVED" ? null : item.nextFollowUp,
                  updatedAt: new Date().toISOString(),
                }
              : item
          )
        );
        showToast(`✓ Removed call log entry from ${targetLead.name}.`);
      } else {
        showToast(res.error || "Failed to delete call log entry");
      }
    });
  };

  // Convert full active queue to CrmLeadItem format for Data Table View so table's internal caller filter sees all leads
  const crmLeadsFromQueue: CrmLeadItem[] = activeQueue.map((l) => ({
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
    updatedAt: l.updatedAt,
    assignedMemberId: l.assignedMemberId,
    assignedMemberName: l.assignedMemberName,
    marketName: l.marketName,
    marketId: l.marketId,
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

  const visibleQueue = React.useMemo(
    () => filteredQueue.slice(0, visibleCardsCount),
    [filteredQueue, visibleCardsCount]
  );

  const groupedDateBatches = React.useMemo<LeadDateBatch[]>(() => {
    const map = new Map<string, LeadDateBatch>();

    for (const lead of visibleQueue) {
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
      const derived = deriveCallStatus(lead);
      if (derived.key === "UNTOUCHED") {
        batch.toCallCount++;
      }
      if (derived.def.depth >= 3) {
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
  }, [visibleQueue]);

  const teamCallers = React.useMemo(
    () => allMembers.filter((m) => m.status !== "SUSPENDED" && m.role !== "VIEWER"),
    [allMembers]
  );

  // Live CRM Telemetry (scoped by active caller filter so Owner or Caller sees exact live numbers)
  const scopedTelemetry = React.useMemo(
    () => computeLiveCrmTelemetry(callerScopedQueue, teamCallers),
    [callerScopedQueue, teamCallers]
  );
  const fullQueueTelemetry = React.useMemo(
    () => computeLiveCrmTelemetry(activeQueue, teamCallers),
    [activeQueue, teamCallers]
  );

  const totalCount = scopedTelemetry.totalLeads;
  const derivedCounts = scopedTelemetry.statusCounts;
  const toCallCount = scopedTelemetry.untouchedLeads;
  const connectedCount = scopedTelemetry.connectedLeads;
  const meetingsCount = scopedTelemetry.meetingsBooked;
  const followUpCount = scopedTelemetry.followUpsScheduled;
  const overdueCount = scopedTelemetry.followUpsOverdue;
  const noAnswerCount = scopedTelemetry.noAnswerLeads;
  const gatekeeperCount = scopedTelemetry.gatekeeperLeads;
  const myLeadsCount = activeQueue.filter(
    (l) => activeMember && l.assignedMemberId === activeMember.id
  ).length;
  const unassignedCount = fullQueueTelemetry.unassignedCount;

  return (
    <div className={effectiveViewMode === "FOCUS" ? "space-y-2" : "space-y-4"}>
      {/* Top Header */}
      {effectiveViewMode === "FOCUS" ? (
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-1">
          {/* Platinum Status Bar: Branding + Niche + Exact Scoped Breakdown */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-white/[0.1] bg-gradient-to-b from-[#131419] to-[#08090c] px-3.5 py-1.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs font-bold text-white tracking-wide">
                {isOwner ? "Calling Console" : `My Calling Console (${activeMember?.name || "Caller"})`}
              </span>
              <span className="text-zinc-700">|</span>
              {canManageSettings && verticalMarkets.length > 1 ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-black/50 p-0.5 border border-white/10">
                  {verticalMarkets.map((vm) => {
                    const isActiveVm = vm.id === marketId;
                    return (
                      <button
                        key={vm.id}
                        type="button"
                        onClick={async () => {
                          if (isActiveVm) return;
                          await switchMarketAction(vm.id);
                          router.refresh();
                        }}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition cursor-pointer ${
                          isActiveVm
                            ? "bg-white text-black shadow-sm"
                            : "text-zinc-400 hover:text-white"
                        }`}
                      >
                        {vm.name}
                      </button>
                    );
                  })}
                </span>
              ) : (
                <span className="text-xs font-medium text-zinc-300">{nicheName}</span>
              )}
              {canManageSettings && (
                <>
                  <span className="text-zinc-700">|</span>
                  <span className="text-xs font-mono font-bold text-white" title="Total unique companies in selected scope">
                    {totalCount} Total Pool
                  </span>
                  <span className="text-[11px] font-mono text-zinc-400">
                    ({toCallCount} Uncalled &bull; {totalCount - toCallCount} Called)
                  </span>
                </>
              )}
            </div>

            {/* Owner Caller Scope Switcher right in Calling Console so Owner always sees All Team vs Caller */}
            {canManageSettings && teamCallers.length > 0 && (
              <div className="inline-flex items-center gap-1 rounded-full border border-white/[0.1] bg-[#07080b] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setCallerFilterAndPersist("ALL")}
                  className={`px-2.5 py-1 rounded-full font-semibold transition cursor-pointer ${
                    callerFilter === "ALL"
                      ? "bg-white text-black font-bold shadow-sm"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  All Team ({activeQueue.length})
                </button>
                {teamCallers.map((c) => {
                  const cCount = fullQueueTelemetry.callerMap[c.id]?.assigned ?? 0;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCallerFilterAndPersist(c.id)}
                      className={`px-2.5 py-1 rounded-full font-semibold transition cursor-pointer ${
                        callerFilter === c.id
                          ? "bg-white text-black font-bold shadow-sm"
                          : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      {c.name} ({cCount})
                    </button>
                  );
                })}
                {unassignedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setCallerFilterAndPersist("UNASSIGNED")}
                    className={`px-2.5 py-1 rounded-full font-semibold transition cursor-pointer ${
                      callerFilter === "UNASSIGNED"
                        ? "bg-white text-black font-bold shadow-sm"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Unassigned ({unassignedCount})
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Owner Shift Sequence & Multi-Caller Pacing Toggle */}
            {canManageSettings && (
              <button
                type="button"
                onClick={() => {
                  const nextOpen = !shiftPanelOpen;
                  setShiftPanelOpen(nextOpen);
                  if (nextOpen) {
                    const target =
                      callerFilter !== "ALL" && callerFilter !== "UNASSIGNED"
                        ? callerFilter
                        : "ALL";
                    selectShiftTarget(target);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-bold transition cursor-pointer shadow-sm ${
                  shiftPanelOpen
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40"
                    : "border-white/[0.12] bg-[#0a0b10] hover:border-emerald-500/40 text-zinc-200 hover:text-white"
                }`}
                title="Configure Daily Shift Quotas, PKT Time Sequence, and Follow-Up/Fresh/Retry Mix across all callers"
              >
                <SlidersHorizontal className="w-3 h-3 text-emerald-400" />
                <span>Shift Sequence</span>
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.2 text-[9px] font-mono text-emerald-300">
                  {activeShiftWeights.followUp}F:{activeShiftWeights.fresh}N:{activeShiftWeights.retry}R • {activeShiftRule.dailyQuotaDials}/d
                </span>
              </button>
            )}

            {/* View Mode Switcher: STRICTLY OWNER ONLY (Sleek Platinum Monochrome — No Neon Green or Lightning Emoji) */}
            {isOwner && (
              <div className="inline-flex items-center p-0.5 rounded-full bg-[#07080b] border border-white/[0.1] text-xs shadow-sm">
                <button
                  type="button"
                  onClick={() => setViewModeAndPersist("FOCUS")}
                  className="flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-gradient-to-b from-white via-zinc-100 to-zinc-300 text-black font-bold shadow-sm transition cursor-pointer"
                >
                  <Phone className="w-3 h-3 text-black" />
                  <span>Calling Console</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewModeAndPersist("SHEET")}
                  className="flex items-center gap-1.5 px-3.5 py-1 rounded-full text-zinc-400 hover:text-white transition cursor-pointer"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  <span>Data Table</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.1] bg-gradient-to-b from-[#121318] via-[#0b0c10] to-[#060709] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)] p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.1] bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-zinc-200 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {nicheName}
              </span>
              <span className="inline-flex items-center rounded-md border border-white/[0.1] bg-white/[0.03] px-2 py-0.5 text-[11px] font-mono font-semibold text-white">
                {totalCount} Leads ({toCallCount} Uncalled &bull; {totalCount - toCallCount} Called)
              </span>
            </div>
            <h1 className="mt-1 text-lg font-bold text-white tracking-tight">
              Leads CRM &amp; Data Table
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isOwner && (
              <div className="flex items-center p-0.5 rounded-full bg-[#060709] border border-white/[0.1] text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setViewModeAndPersist("FOCUS")}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-zinc-300 hover:text-white font-semibold transition cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Calling Console</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewModeAndPersist("SHEET")}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-b from-white via-zinc-100 to-zinc-300 text-black font-bold transition cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-black" />
                  <span>Data Table</span>
                </button>
              </div>
            )}

            {isOwner && marketId && (
              <button
                type="button"
                onClick={() => setIsAddingColumn(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 px-3 py-2 text-xs font-semibold transition shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Column</span>
              </button>
            )}

            {isOwner && marketId && (
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
                title="Distribute leads evenly among active callers"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {distributePending ? "Distributing..." : "Auto-Assign"}
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


          </div>
        </div>
      )}

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

      {/* Owner Team Callers Overview & Lead Assignment Command Bar (Cards View) */}
      {effectiveViewMode === "CARDS" && canManageSettings && teamCallers.length > 0 ? (
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
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                <span>Dials: <strong className="text-sky-300">{fullQueueTelemetry.totalCallsDialed}</strong></span>
                <span>&bull;</span>
                <span>Ans: <strong className="text-cyan-300">{fullQueueTelemetry.answeredLeads}</strong></span>
                <span>&bull;</span>
                <span>Spoke: <strong className="text-indigo-300">{fullQueueTelemetry.connectedLeads}</strong></span>
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
              const cStats = fullQueueTelemetry.callerMap[caller.id];
              const cAssigned = cStats?.assigned ?? 0;
              const cDialed = cStats?.callsLogged ?? 0;
              const cAnswered = cStats?.answered ?? 0;
              const cConnected = cStats?.connected ?? 0;
              const cFollowUps = cStats?.followUps ?? 0;
              const cMeetings = cStats?.meetings ?? 0;
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
                      {cAssigned} leads
                    </span>
                  </div>

                </button>
              );
            })}
          </div>
        </div>
      ) : viewMode === "CARDS" && activeMember?.role === "CALLER" ? (
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
                Showing leads assigned directly to your active calling shift
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <span className="rounded-lg bg-[#09090b] border border-zinc-800 px-3 py-1.5 text-zinc-300">
              Calls Dialed: <strong className="text-sky-300">{scopedTelemetry.totalCallsDialed}</strong>{" "}
              <span className="text-[10px] text-zinc-500">({scopedTelemetry.dialedLeads} leads)</span>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-zinc-800 px-3 py-1.5 text-zinc-300">
              Answered: <strong className="text-cyan-300">{scopedTelemetry.answeredLeads}</strong>{" "}
              <span className="text-[10px] text-zinc-500">({scopedTelemetry.answerRatePct}%)</span>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-zinc-800 px-3 py-1.5 text-zinc-300">
              Connected: <strong className="text-indigo-300">{connectedCount}</strong>{" "}
              <span className="text-[10px] text-zinc-500">({scopedTelemetry.connectRatePct}%)</span>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-zinc-800 px-3 py-1.5 text-zinc-300">
              Follow-Ups: <strong className="text-amber-300">{followUpCount}</strong>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-zinc-800 px-3 py-1.5 text-zinc-300">
              Meetings Booked: <strong className="text-emerald-400">{meetingsCount}</strong>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-zinc-800 px-3 py-1.5 text-zinc-300">
              No Answer / VM: <strong className="text-amber-400/90">{noAnswerCount + scopedTelemetry.voicemailLeads}</strong>
            </span>
            <span className="rounded-lg bg-[#09090b] border border-zinc-800 px-3 py-1.5 text-zinc-300">
              Gatekeeper: <strong className="text-orange-400">{gatekeeperCount}</strong>
            </span>

          </div>
        </div>
      ) : null}

      {effectiveViewMode === "FOCUS" ? (
        <>
          {/* Owner Shift Sequence & Multi-Caller Pacer Panel */}
          {canManageSettings && shiftPanelOpen && (
            <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-[#11141a] via-[#0b0d12] to-[#08090d] p-4 space-y-4 shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-sm font-bold text-white">
                      Owner Shift Sequence &amp; Multi-Caller Pacer
                    </h2>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/35 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      <Clock className="w-3 h-3" />
                      <span>{activeNightBlock.title}</span>
                      <span className="text-zinc-400 font-mono">({activeNightBlock.pktTimeFormatted})</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Control daily shift quotas, PKT night calling blocks, and the automatic Follow-Up / Fresh / Retry cycle for every cold caller.
                    {shiftConfig.updatedAt && (
                      <span className="ml-2 text-zinc-500">
                        Last updated by {shiftConfig.updatedBy || "Owner"}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShiftPanelOpen(false)}
                  className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/[0.08] cursor-pointer"
                  title="Close Shift Sequence Panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* All Callers Live Shift Progress Grid */}
              {teamCallers.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {teamCallers.map((caller) => {
                    const callerLeads = activeQueue.filter(
                      (l) => l.assignedMemberId === caller.id
                    );
                    const cRule = resolveCallerShiftRule(shiftConfig, caller.id);
                    const cSummary = computeCallerShiftSummary(callerLeads, cRule);
                    const hasCustomOverride = Boolean(shiftConfig.callerOverrides?.[caller.id]);
                    const progressPct = Math.min(
                      100,
                      Math.round((cSummary.dialedTodayTotal / Math.max(1, cSummary.dailyQuotaDials)) * 100)
                    );
                    const isEditingThis = shiftTargetCallerId === caller.id;
                    const isViewingThis = callerFilter === caller.id;

                    return (
                      <div
                        key={caller.id}
                        className={`rounded-xl border p-3 space-y-2 transition ${
                          isEditingThis
                            ? "border-emerald-400 bg-emerald-500/10 ring-1 ring-emerald-400/30"
                            : isViewingThis
                            ? "border-white/30 bg-white/[0.04]"
                            : "border-white/[0.08] bg-[#07080b] hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span className="text-xs font-bold text-white truncate">
                              {caller.name}
                            </span>
                            <span
                              className={`rounded-full px-1.5 py-0.2 text-[9px] font-bold border ${
                                hasCustomOverride
                                  ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
                                  : "border-white/10 bg-white/[0.04] text-zinc-400"
                              }`}
                            >
                              {hasCustomOverride ? "Custom" : "Default"}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono font-bold text-zinc-300 shrink-0">
                            {cSummary.totalPool} leads
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-1 text-[10px]">
                          <div className="rounded-lg bg-black/50 border border-amber-500/20 px-2 py-1">
                            <div className="text-zinc-400 text-[9px]">Follow-Up</div>
                            <div className="font-mono font-bold text-amber-300">
                              {cSummary.followUpsDoneToday}/{cSummary.todayFollowUpQuota}
                            </div>
                            <div className="text-[9px] text-zinc-500">
                              Pool {cSummary.totalFollowUps}
                              {cSummary.agingFollowUps > 0 ? ` • ${cSummary.agingFollowUps} >48h` : ""}
                            </div>
                          </div>
                          <div className="rounded-lg bg-black/50 border border-emerald-500/20 px-2 py-1">
                            <div className="text-zinc-400 text-[9px]">Fresh</div>
                            <div className="font-mono font-bold text-emerald-300">
                              {cSummary.freshDoneToday}/{cSummary.todayFreshQuota}
                            </div>
                            <div className="text-[9px] text-zinc-500">
                              Pool {cSummary.totalFresh}
                              {cSummary.agingFresh > 0 ? ` • ${cSummary.agingFresh} >3d` : ""}
                            </div>
                          </div>
                          <div className="rounded-lg bg-black/50 border border-sky-500/20 px-2 py-1">
                            <div className="text-zinc-400 text-[9px]">Retry</div>
                            <div className="font-mono font-bold text-sky-300">
                              {cSummary.retriesDoneToday}/{cSummary.todayRetryQuota}
                            </div>
                            <div className="text-[9px] text-zinc-500">
                              Pool {cSummary.totalRetries}
                              {cSummary.agingRetries > 0 ? ` • ${cSummary.agingRetries} >48h` : ""}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-zinc-400">
                            <span>
                              Shift Dials:{" "}
                              <strong className="text-white font-mono">
                                {cSummary.dialedTodayTotal}/{cSummary.dailyQuotaDials}
                              </strong>
                            </span>
                            <span>
                              Meetings:{" "}
                              <strong className="text-emerald-400 font-mono">
                                {cSummary.meetingsToday}
                              </strong>
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-zinc-900 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-all"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 pt-0.5">
                          <button
                            type="button"
                            onClick={() => setCallerFilterAndPersist(caller.id)}
                            className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.1] px-2 py-1 text-[10px] font-semibold text-zinc-200 transition cursor-pointer"
                          >
                            {isViewingThis ? "Viewing Queue" : "View Queue"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              selectShiftTarget(caller.id);
                              setCallerFilterAndPersist(caller.id);
                            }}
                            className="flex-1 rounded-lg border border-emerald-500/35 bg-emerald-500/15 hover:bg-emerald-500/25 px-2 py-1 text-[10px] font-bold text-emerald-200 transition cursor-pointer"
                          >
                            Edit Shift Rule
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Shift Rule Editor */}
              <div className="rounded-xl border border-white/[0.08] bg-[#07080b] p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-white">Editing Rule For:</span>
                    <select
                      value={shiftTargetCallerId}
                      onChange={(e) => selectShiftTarget(e.target.value)}
                      className="rounded-lg border border-white/15 bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white focus:outline-none focus:border-emerald-400"
                    >
                      <option value="ALL">All Callers (Workspace Default)</option>
                      {teamCallers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {shiftConfig.callerOverrides?.[c.id] ? "(Custom Override)" : "(Uses Default)"}
                        </option>
                      ))}
                    </select>
                    {shiftTargetCallerId !== "ALL" &&
                      Boolean(shiftConfig.callerOverrides?.[shiftTargetCallerId]) && (
                        <button
                          type="button"
                          disabled={shiftSavePending}
                          onClick={() => handleResetCallerShiftOverride(shiftTargetCallerId)}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 text-[10px] font-semibold text-amber-200 transition cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reset to Default</span>
                        </button>
                      )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[11px]">
                    <label className="inline-flex items-center gap-1.5 text-zinc-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={shiftDraftRule.enabled}
                        onChange={(e) =>
                          setShiftDraftRule((prev) => ({
                            ...prev,
                            enabled: e.target.checked,
                          }))
                        }
                        className="accent-emerald-400"
                      />
                      <span>Enable Shift Auto-Mix</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={shiftDraftRule.lockCallerToShiftMix}
                        onChange={(e) =>
                          setShiftDraftRule((prev) => ({
                            ...prev,
                            lockCallerToShiftMix: e.target.checked,
                          }))
                        }
                        className="accent-emerald-400"
                      />
                      <span>Default Callers to Shift Mix</span>
                    </label>
                  </div>
                </div>

                {/* Pacing Modes */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Shift Sequence Mode
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
                    {(
                      [
                        {
                          id: "AUTO_TIME_SEQUENCE",
                          title: "Auto PKT Sequence",
                          sub: "Follows 6PM / 8:30PM / 11:30PM blocks",
                        },
                        {
                          id: "BALANCED_5_CALL",
                          title: "Balanced 5-Call",
                          sub: "2 Follow-Up : 2 Fresh : 1 Retry",
                        },
                        {
                          id: "FRESH_POWER_HOUR",
                          title: "Fresh Power Hour",
                          sub: "1 Follow-Up : 3 Fresh : 1 Retry",
                        },
                        {
                          id: "FOLLOW_UP_BLITZ",
                          title: "Follow-Up Blitz",
                          sub: "3 Follow-Up : 1 Fresh : 1 Retry",
                        },
                        {
                          id: "RETRY_CLEANUP",
                          title: "Retry Cleanup",
                          sub: "1 Follow-Up : 1 Fresh : 3 Retry",
                        },
                        {
                          id: "CUSTOM_RATIO",
                          title: "Custom Ratio",
                          sub: "Set your own cycle weights",
                        },
                      ] as Array<{ id: ShiftPacingMode; title: string; sub: string }>
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          setShiftDraftRule((prev) => ({ ...prev, mode: m.id }))
                        }
                        className={`rounded-lg border px-2.5 py-2 text-left transition cursor-pointer ${
                          shiftDraftRule.mode === m.id
                            ? "border-emerald-400 bg-emerald-500/20 text-white"
                            : "border-white/[0.08] bg-black/40 text-zinc-300 hover:border-white/25"
                        }`}
                      >
                        <div className="text-[11px] font-bold">{m.title}</div>
                        <div className="text-[9px] text-zinc-400 mt-0.5">{m.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Daily Quotas, Anti-Decay Guards & Custom Ratio Inputs */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 items-end">
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-400 mb-1">
                      Daily Quota (Dials)
                    </label>
                    <input
                      type="number"
                      min={10}
                      max={1000}
                      value={shiftDraftRule.dailyQuotaDials}
                      onChange={(e) =>
                        setShiftDraftRule((prev) => ({
                          ...prev,
                          dailyQuotaDials: Number(e.target.value) || 120,
                        }))
                      }
                      className="w-full rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                  <div>
                    <label
                      className="block text-[10px] font-semibold text-amber-300 mb-1"
                      title="Spreads accumulated follow-ups safely across shifts while keeping Owner Connected callbacks at #1"
                    >
                      Max Follow-Ups / Shift
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={shiftDraftRule.followUpDailyCap}
                      onChange={(e) =>
                        setShiftDraftRule((prev) => ({
                          ...prev,
                          followUpDailyCap: Number(e.target.value) || 25,
                        }))
                      }
                      className="w-full rounded-lg border border-amber-500/30 bg-black/60 px-2.5 py-1.5 text-xs font-mono text-amber-200 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-emerald-300 mb-1">
                      Fresh Daily Target
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      value={shiftDraftRule.freshDailyTarget}
                      onChange={(e) =>
                        setShiftDraftRule((prev) => ({
                          ...prev,
                          freshDailyTarget: Number(e.target.value) || 0,
                        }))
                      }
                      className="w-full rounded-lg border border-emerald-500/30 bg-black/60 px-2.5 py-1.5 text-xs font-mono text-emerald-200 focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-sky-300 mb-1">
                      Retry Daily Target
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      value={shiftDraftRule.retryDailyTarget}
                      onChange={(e) =>
                        setShiftDraftRule((prev) => ({
                          ...prev,
                          retryDailyTarget: Number(e.target.value) || 0,
                        }))
                      }
                      className="w-full rounded-lg border border-sky-500/30 bg-black/60 px-2.5 py-1.5 text-xs font-mono text-sky-200 focus:outline-none focus:border-sky-400"
                    />
                  </div>
                  <div>
                    <label
                      className="block text-[10px] font-semibold text-zinc-300 mb-1"
                      title="After this many unanswered attempts, lead rests 7 days at tail so Retry Pool never bloats"
                    >
                      Max Retries (7d Rest)
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={15}
                      value={shiftDraftRule.maxRetryAttempts}
                      onChange={(e) =>
                        setShiftDraftRule((prev) => ({
                          ...prev,
                          maxRetryAttempts: Number(e.target.value) || 6,
                        }))
                      }
                      className="w-full rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                  <div>
                    <label
                      className="block text-[10px] font-semibold text-zinc-300 mb-1"
                      title="Minimum hours before re-dialing the same unanswered lead within a shift"
                    >
                      Retry Cooldown (hrs)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={48}
                      value={shiftDraftRule.retryCooldownHours}
                      onChange={(e) =>
                        setShiftDraftRule((prev) => ({
                          ...prev,
                          retryCooldownHours: Number(e.target.value) || 4,
                        }))
                      }
                      className="w-full rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                    />
                  </div>

                  {shiftDraftRule.mode === "CUSTOM_RATIO" && (
                    <>
                      <div>
                        <label className="block text-[10px] font-semibold text-zinc-400 mb-1">
                          FU Weight
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={shiftDraftRule.followUpWeight}
                          onChange={(e) =>
                            setShiftDraftRule((prev) => ({
                              ...prev,
                              followUpWeight: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                            }))
                          }
                          className="w-full rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-zinc-400 mb-1">
                          Fresh Weight
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={shiftDraftRule.freshWeight}
                          onChange={(e) =>
                            setShiftDraftRule((prev) => ({
                              ...prev,
                              freshWeight: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                            }))
                          }
                          className="w-full rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-zinc-400 mb-1">
                          Retry Weight
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={shiftDraftRule.retryWeight}
                          onChange={(e) =>
                            setShiftDraftRule((prev) => ({
                              ...prev,
                              retryWeight: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                            }))
                          }
                          className="w-full rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/[0.06]">
                  <p className="text-[10px] text-zinc-400">
                    Anti-Decay active: Owner <strong className="text-zinc-200">Connected</strong> callbacks lock #1, accumulated follow-ups rotate oldest + newest so none go dead, Fresh &gt;3d get boosted, and {shiftDraftRule.maxRetryAttempts}+ attempt misses rest 7 days with zero data loss.
                  </p>
                  <button
                    type="button"
                    disabled={shiftSavePending}
                    onClick={handleSaveShiftRule}
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-extrabold px-4 py-1.5 text-xs transition shadow-sm cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>
                      {shiftSavePending ? "Saving..." : "Save Shift Sequence"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          <CallerFocusCockpit
            leads={callerScopedQueue}
            isOwner={isOwner}
            telemetry={scopedTelemetry}
            nicheName={nicheName}
            smartFields={smartFields}
            activeActorName={actor.trim() || activeActorName}
            canEditContacts={canEditContacts}
            allMembers={allMembers}
            onAssignLead={handleAssignLead}
            initialTzFilter={initialTzFilter}
            initialWindowFilter={initialWindowFilter}
            shiftRule={activeShiftRule}
            getOpeningScript={(leadItem) =>
              getSmartOpeningScript({
                companyName: leadItem.name,
                contactName: leadItem.bestContact.name,
                city: leadItem.city,
                state: leadItem.state,
                nicheName: leadItem.marketName || nicheName,
                cleanNotes: stripFollowUpTagFromNotes(leadItem.notes),
                researchSummary: leadItem.researchSummary,
              })
            }
            onLogCallAndAdvance={handleFocusCockpitSubmit}
            onRescheduleFollowUp={handleCockpitRescheduleFollowUp}
            onSmartFieldChange={handleSmartFieldChange}
            onOpenEditLead={openEditModal}
            onOpenEmailModal={(lead) => setEmailModalLead(lead)}
            onOpenMeetingModal={(lead) => setMeetingModalLead(lead)}
            onResetLead={handleResetLead}
            onDeleteCallLog={handleDeleteCallLogEntry}
            onSwitchToFullCrm={isOwner ? (filterStatus) => {
              if (filterStatus) setStatusFilterAndPersist(filterStatus);
              setViewModeAndPersist("SHEET");
            } : undefined}
          />
        </>
      ) : effectiveViewMode === "SHEET" ? (
        <CrmLeadSheet
          initialLeads={crmLeadsFromQueue}
          marketId={marketId}
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
          initialTzFilter={initialTzFilter}
          initialWindowFilter={initialWindowFilter}
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
                      dealStage:
                        (updated as any).dealStage !== undefined
                          ? (updated as any).dealStage
                          : updated.status === "MEETING_BOOKED"
                          ? "MEETING_BOOKED"
                          : "NONE",
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
              onClick={() => setDateFilterAndPersist("ALL")}
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
              onClick={() => setDateFilterAndPersist("TODAY")}
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
              onClick={() => setDateFilterAndPersist("YESTERDAY")}
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
                onClick={() => setDateFilterAndPersist("OLDER")}
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
                  onClick={() => setStatusFilterAndPersist(tab.key)}
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
            queue.length > 0 ? (
              <div className="p-8 my-4 text-center rounded-2xl border border-white/10 bg-[#121215]/90 backdrop-blur-xl space-y-3 shadow-lg">
                <div className="inline-flex items-center justify-center p-3 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-sm">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-base font-bold text-white">
                    {statusFilter === "TO_CALL" || statusFilter === "UNTOUCHED"
                      ? `All ${queue.length} leads have been dialed! Zero uncalled leads remaining.`
                      : `No leads currently match "${statusFilter}".`}
                  </p>
                  <p className="text-xs text-zinc-400 max-w-lg mx-auto mt-1 leading-relaxed">
                    All <strong className="text-emerald-400 font-mono font-bold">{queue.length} leads</strong> are 100% safe, saved, and active in your CRM database.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilterAndPersist("ALL");
                      setCallerFilter("ALL");
                      setDateFilterAndPersist("ALL");
                      setSearch("");
                    }}
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black px-5 py-2 text-xs font-extrabold shadow-sm transition cursor-pointer"
                  >
                    <span>Reset All Filters &amp; View All {queue.length} Leads &rarr;</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center rounded-xl border border-zinc-800/80 bg-[#121215] text-zinc-400 space-y-3">
                <PhoneCall className="w-7 h-7 text-zinc-600 mx-auto" />
                <p className="text-sm font-semibold text-zinc-200">
                  No leads in this market
                </p>
                <p className="text-xs max-w-md mx-auto">
                  Extract or import new verified leads to get started.
                </p>
              </div>
            )
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

                          {/* Automatic Log-Derived Call Status (Unified Pipeline) */}
                          <CallStatusBadge lead={lead} showAttempts showLastCalled />

                          {/* Email Status Badge (Pending / Sent) */}
                          {(() => {
                            const emailStatus = getLeadEmailStatus(lead);
                            if (emailStatus === "PENDING") {
                              return (
                                <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-300">
                                  <Mail className="w-3 h-3 text-amber-400" />
                                  <span>Email Pending</span>
                                </span>
                              );
                            }
                            if (emailStatus === "SENT") {
                              return (
                                <span className="inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs font-semibold text-sky-300">
                                  <Mail className="w-3 h-3 text-sky-400" />
                                  <span>Email Sent</span>
                                </span>
                              );
                            }
                            return null;
                          })()}

                          {recentlyDialedIds.has(lead.companyId) && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-sm animate-in fade-in">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                              <span>Just Dialed</span>
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
                                    .filter((m) => m.status !== "SUSPENDED" && m.role !== "VIEWER")
                                    .map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.name} ({ROLE_PRESETS[m.role]?.shortLabel || m.role})
                                        {m.status === "INVITED" ? " (Invited)" : ""}
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
                        <button
                          type="button"
                          onClick={() => setMeetingModalLead(lead)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-950/40 hover:bg-emerald-900/60 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:text-white transition cursor-pointer"
                          title="Book Discovery Meeting"
                        >
                          <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Book Meeting</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEmailModalLead(lead)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-950/40 hover:bg-sky-900/60 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:text-white transition cursor-pointer"
                          title="Compose & Send Sales Email to Prospect"
                        >
                          <Mail className="w-3.5 h-3.5 text-sky-400" />
                          <span>Send Email</span>
                        </button>
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
                        {deriveCallStatus(lead).key !== "UNTOUCHED" && (
                          <button
                            type="button"
                            onClick={() => handleResetLead(lead)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 px-3 py-2 text-xs font-bold text-rose-200 transition"
                            title="Reset lead outcome and clear callbacks back to Ready to Call"
                          >
                            <span>↺ Reset to Fresh</span>
                          </button>
                        )}
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
              {filteredQueue.length > visibleCardsCount && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-xl border border-zinc-800 bg-[#121215]">
                  <div className="text-xs text-zinc-400">
                    Showing <strong className="text-white">{Math.min(visibleCardsCount, filteredQueue.length)}</strong> of{" "}
                    <strong className="text-white">{filteredQueue.length}</strong> leads
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setVisibleCardsCount((prev) => prev + 50)}
                      className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white transition shadow-sm"
                    >
                      Load Next 50 Leads
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibleCardsCount(filteredQueue.length)}
                      className="px-3 py-2 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-xs text-zinc-400 hover:text-white transition"
                    >
                      Show All ({filteredQueue.length})
                    </button>
                  </div>
                </div>
              )}
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
                      onClick={() =>
                        setFollowUpInput(
                          buildPresetFollowUpIso(item.preset, followUpTarget.state)
                        )
                      }
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
                        .filter((m) => m.status !== "SUSPENDED" && m.role !== "VIEWER")
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({ROLE_PRESETS[m.role]?.shortLabel || m.role})
                            {m.status === "INVITED" ? " (Invited)" : ""}
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

      {/* Call Outcome & Follow-Up Modal (Isolated Component - Zero typing lag) */}
      {selectedLead && (
        <CallLogModal
          lead={selectedLead}
          activeActorName={actor.trim() || activeActorName}
          isSubmitting={isPending}
          onClose={() => setSelectedLead(null)}
          onSubmit={handleLogCallSubmit}
        />
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

      {/* Outbound Prospect Email Compose Modal */}
      {emailModalLead && (
        <EmailComposeModal
          isOpen={!!emailModalLead}
          onClose={() => setEmailModalLead(null)}
          lead={emailModalLead}
          actorName={actor.trim() || activeActorName || "Sales Agent"}
          onEmailSent={handleEmailSent}
        />
      )}

      {/* Structured Discovery Meeting Booking Modal */}
      {meetingModalLead && (
        <MeetingBookingModal
          isOpen={!!meetingModalLead}
          onClose={() => setMeetingModalLead(null)}
          lead={meetingModalLead}
          actorName={actor.trim() || activeActorName || "Sales Caller"}
          onMeetingBooked={handleMeetingBooked}
        />
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
