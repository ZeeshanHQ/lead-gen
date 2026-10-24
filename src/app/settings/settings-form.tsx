"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateSettingAction,
  inviteTeamMemberAction,
  updateTeamMemberAccessAction,
  regenerateInviteTokenAction,
  removeTeamMemberAction,
  switchActiveMemberAction,
  sendTeamInviteEmailAction,
  updateMyProfileAction,
} from "./actions";
import {
  Shield,
  Lock,
  Mail,
  Link2,
  Check,
  X,
  Minus,
  UserCheck,
  Upload,
  Download,
} from "lucide-react";
import {
  saveDialerConfigAction,
  pushLeadsToDialerAction,
} from "@/app/caller/actions";
import {
  ROLE_PRESETS,
  PERMISSION_DEFINITIONS,
  getPermissionsForRole,
  type TeamMember,
  type TeamRole,
  type TeamPermissions,
  type MemberStatus,
} from "@/server/domain/team";
import {
  DEFAULT_DIALER_CONFIG,
  type DialerConfig,
} from "@/server/domain/dialer";
import type { MarketView } from "@/server/repo/markets";
import type { ProviderRequirement } from "@/server/env";

type SettingsTab = "team" | "roles" | "dialer" | "general" | "apps";

const ROLE_LIST = Object.values(ROLE_PRESETS);
const ASSIGNABLE_ROLES = ROLE_LIST.filter((r) => r.role !== "OWNER");

function countEnabledPermissions(perms: TeamPermissions): number {
  return PERMISSION_DEFINITIONS.filter((p) => perms[p.key]).length;
}

export function SettingsForm({
  initialSettings,
  requirements,
  initialMembers,
  activeMember: initialActiveMember,
  allMarkets,
  activeTenantName,
  initialDialerConfig = DEFAULT_DIALER_CONFIG,
}: {
  initialSettings: Record<string, unknown>;
  requirements: ProviderRequirement[];
  initialMembers: TeamMember[];
  activeMember: TeamMember;
  allMarkets: MarketView[];
  activeTenantName: string;
  initialDialerConfig?: DialerConfig;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("team");
  const [isPending, startTransition] = useTransition();

  // Team state
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<TeamRole | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<MemberStatus | "ALL">("ALL");

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTitle, setInviteTitle] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("CALLER");
  const [inviteNicheScope, setInviteNicheScope] = useState<"ALL" | "SELECTED">("ALL");
  const [inviteNicheIds, setInviteNicheIds] = useState<string[]>([]);
  const [invitePerms, setInvitePerms] = useState<TeamPermissions>(getPermissionsForRole("CALLER"));
  const [inviteAutoActive, setInviteAutoActive] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedRowMemberId, setCopiedRowMemberId] = useState<string | null>(null);
  const [createdInviteLink, setCreatedInviteLink] = useState<{
    memberId: string;
    name: string;
    role: string;
    email: string;
    link: string;
    sentDirectly?: boolean;
    mailtoUrl?: string;
  } | null>(null);

  // Edit access drawer state
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editRole, setEditRole] = useState<TeamRole>("REVIEWER");
  const [editStatus, setEditStatus] = useState<MemberStatus>("ACTIVE");
  const [editNicheScope, setEditNicheScope] = useState<"ALL" | "SELECTED">("ALL");
  const [editNicheIds, setEditNicheIds] = useState<string[]>([]);
  const [editPerms, setEditPerms] = useState<TeamPermissions>(getPermissionsForRole("REVIEWER"));
  const [editError, setEditError] = useState<string | null>(null);

  // Dialer integration state
  const [dialerPlatformName, setDialerPlatformName] = useState(
    initialDialerConfig.platformName || "External Dialer"
  );
  const [dialerLaunchUrl, setDialerLaunchUrl] = useState(
    initialDialerConfig.launchUrlTemplate || "tel:{phone}"
  );
  const [dialerWebhookUrl, setDialerWebhookUrl] = useState(
    initialDialerConfig.webhookUrl || ""
  );
  const [dialerApiKey, setDialerApiKey] = useState(initialDialerConfig.apiKey || "");
  const [dialerCampaign, setDialerCampaign] = useState(
    initialDialerConfig.defaultCampaign || "Outbound Leads"
  );
  const [dialerAutoPush, setDialerAutoPush] = useState(
    Boolean(initialDialerConfig.autoPushOnApprove)
  );

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // General settings state
  const [actorName, setActorName] = useState(
    String(initialSettings.actor_name ?? "Workspace Owner")
  );
  const [saveRawSnapshots, setSaveRawSnapshots] = useState(
    Boolean(initialSettings.save_raw_snapshots ?? true)
  );
  const [snapshotRetentionDays, setSnapshotRetentionDays] = useState(
    Number(initialSettings.snapshot_retention_days ?? 90)
  );
  const [dedupePhoneHard, setDedupePhoneHard] = useState(
    Boolean(initialSettings.dedupe_phone_hard ?? true)
  );
  const [reviewSlaHours, setReviewSlaHours] = useState(
    Number(initialSettings.review_sla_hours ?? 24)
  );
  const [defaultSheetTarget, setDefaultSheetTarget] = useState(
    String(initialSettings.default_sheet_target ?? "")
  );

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }

  function getInitials(name: string) {
    return name
      .replace(/\(You\)/gi, "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }

  function handleInviteRoleChange(nextRole: TeamRole) {
    setInviteRole(nextRole);
    setInvitePerms(getPermissionsForRole(nextRole));
  }

  function toggleInviteNiche(nicheId: string) {
    setInviteNicheIds((prev) =>
      prev.includes(nicheId) ? prev.filter((id) => id !== nicheId) : [...prev, nicheId]
    );
  }

  function openEditDrawer(member: TeamMember) {
    setEditingMember(member);
    setEditName(member.name);
    setEditEmail(member.email);
    setEditTitle(member.title || "");
    setEditRole(member.role);
    setEditStatus(member.status);
    setEditNicheScope(member.nicheScope);
    setEditNicheIds(member.allowedNicheIds || []);
    setEditPerms({ ...member.permissions });
    setEditError(null);
  }

  function handleEditRolePreset(nextRole: TeamRole) {
    setEditRole(nextRole);
    setEditPerms(getPermissionsForRole(nextRole));
  }

  function toggleEditNiche(nicheId: string) {
    setEditNicheIds((prev) =>
      prev.includes(nicheId) ? prev.filter((id) => id !== nicheId) : [...prev, nicheId]
    );
  }

  function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    if (inviteNicheScope === "SELECTED" && inviteNicheIds.length === 0) {
      setInviteError("Please select at least one niche, or choose All Niches.");
      return;
    }

    startTransition(async () => {
      const res = await inviteTeamMemberAction({
        name: inviteName,
        email: inviteEmail,
        title: inviteTitle,
        role: inviteRole,
        nicheScope: inviteNicheScope,
        allowedNicheIds: inviteNicheIds,
        permissions: invitePerms,
        activateImmediately: inviteAutoActive,
      });

      if (!res.ok || !res.member) {
        setInviteError(res.error || "Could not invite member");
        return;
      }

      const origin =
        typeof window !== "undefined" ? window.location.origin : "https://leads.astraventa.com";
      const inviteUrl = `${origin}/invite/${res.member.inviteToken || res.member.id}`;
      setCreatedInviteLink({
        memberId: res.member.id,
        name: res.member.name,
        role: res.member.role,
        email: res.member.email,
        link: inviteUrl,
      });
      setInviteName("");
      setInviteEmail("");
      setInviteTitle("");
      showToast(`${res.member.name} has been added to your team.`);
      router.refresh();
    });
  }

  function handleSaveMemberEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingMember) return;
    setEditError(null);

    if (editNicheScope === "SELECTED" && editNicheIds.length === 0) {
      setEditError("Please select at least one niche, or choose All Niches.");
      return;
    }

    startTransition(async () => {
      const res = await updateTeamMemberAccessAction(editingMember.id, {
        name: editName,
        email: editEmail,
        title: editTitle,
        role: editRole,
        status: editStatus,
        nicheScope: editNicheScope,
        allowedNicheIds: editNicheIds,
        permissions: editPerms,
      });
      if (!res.ok) {
        setEditError(res.error || "Could not update member");
        return;
      }
      setEditingMember(null);
      showToast(`Saved access settings for ${editName}.`);
      router.refresh();
    });
  }

  function handleQuickRoleChange(member: TeamMember, nextRole: TeamRole) {
    startTransition(async () => {
      const res = await updateTeamMemberAccessAction(member.id, {
        role: nextRole,
        permissions: getPermissionsForRole(nextRole),
      });
      if (!res.ok) {
        showToast(res.error || "Could not change role");
        return;
      }
      showToast(`Updated ${member.name}'s role to ${ROLE_PRESETS[nextRole]?.label || nextRole}.`);
      router.refresh();
    });
  }

  function handleCopyInviteLink(member: TeamMember) {
    startTransition(async () => {
      const res = await regenerateInviteTokenAction(member.id);
      if (!res.ok || !res.inviteToken) {
        showToast(res.error || "Could not generate link");
        return;
      }
      const origin =
        typeof window !== "undefined" ? window.location.origin : "https://leads.astraventa.com";
      const url = `${origin}/invite/${res.inviteToken}`;
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
      setCopiedRowMemberId(member.id);
      setTimeout(() => setCopiedRowMemberId(null), 2500);
      showToast(`Invite link copied for ${member.name}.`);
      router.refresh();
    });
  }

  async function handleSendInviteEmail(memberId: string, customOrigin?: string) {
    setIsSendingEmail(true);
    try {
      const origin =
        customOrigin || (typeof window !== "undefined" ? window.location.origin : "https://leads.astraventa.com");
      const res = await sendTeamInviteEmailAction({ memberId, origin });
      if (res.ok) {
        if (res.directSent) {
          showToast(`Invitation email dispatched directly to ${res.member?.email}!`);
          setCreatedInviteLink((prev) =>
            prev && prev.memberId === memberId
              ? { ...prev, sentDirectly: true }
              : prev
          );
        } else {
          if (res.mailtoUrl && typeof window !== "undefined") {
            window.open(res.mailtoUrl, "_blank");
          }
          showToast(`Opened email draft for ${res.member?.name}.`);
          setCreatedInviteLink((prev) =>
            prev && prev.memberId === memberId
              ? { ...prev, sentDirectly: false, mailtoUrl: res.mailtoUrl }
              : prev
          );
        }
      } else {
        showToast(res.error || "Failed to dispatch email");
      }
    } catch (err: any) {
      showToast(err.message || "Failed to dispatch email");
    } finally {
      setIsSendingEmail(false);
    }
  }

  function handleRemoveMember(member: TeamMember) {
    if (!window.confirm(`Remove "${member.name}" from your team?`)) return;
    startTransition(async () => {
      const res = await removeTeamMemberAction(member.id);
      if (!res.ok) {
        showToast(res.error || "Could not remove member");
        return;
      }
      if (editingMember?.id === member.id) setEditingMember(null);
      showToast(`Removed ${member.name} from the team.`);
      router.refresh();
    });
  }

  function handleSwitchMember(memberId: string) {
    startTransition(async () => {
      const res = await switchActiveMemberAction(memberId);
      if (!res.ok || !res.member) {
        showToast(res.error || "Could not switch view");
        return;
      }
      showToast(
        `Now viewing workspace as ${res.member.name} (${ROLE_PRESETS[res.member.role]?.label}).`
      );
      router.refresh();
    });
  }

  function handleSaveDialerSettings(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveDialerConfigAction({
        enabled: true,
        platformName: dialerPlatformName,
        launchUrlTemplate: dialerLaunchUrl,
        webhookUrl: dialerWebhookUrl,
        apiKey: dialerApiKey,
        defaultCampaign: dialerCampaign,
        autoPushOnApprove: dialerAutoPush,
      });
      if (!res.ok) {
        showToast(res.error || "Could not save dialer settings");
        return;
      }
      showToast(`Saved ${dialerPlatformName} integration settings.`);
      router.refresh();
    });
  }

  function handleTestDialerPush() {
    startTransition(async () => {
      await saveDialerConfigAction({
        enabled: true,
        platformName: dialerPlatformName,
        launchUrlTemplate: dialerLaunchUrl,
        webhookUrl: dialerWebhookUrl,
        apiKey: dialerApiKey,
        defaultCampaign: dialerCampaign,
        autoPushOnApprove: dialerAutoPush,
      });
      const res = await pushLeadsToDialerAction([
        {
          id: "test_lead_01",
          name: "Sample Prospect Co.",
          contactName: "John Carter",
          contactTitle: "Owner",
          phone: "+15125550199",
          email: "john@sampleprospect.com",
          city: "Austin",
          state: "TX",
          niche: allMarkets[0]?.name || "General",
          icpScore: 88,
          notes: "Test lead sent from Dialer Integration settings.",
        },
      ]);
      if (res.ok) {
        showToast(
          `Test lead sent to ${res.platformName} (${res.campaign}).`
        );
      } else {
        showToast(res.error || "Test failed");
      }
    });
  }

  function handleSaveGeneralSettings(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      await Promise.all([
        updateSettingAction("actor_name", actorName),
        updateSettingAction("save_raw_snapshots", saveRawSnapshots),
        updateSettingAction("snapshot_retention_days", snapshotRetentionDays),
        updateSettingAction("dedupe_phone_hard", dedupePhoneHard),
        updateSettingAction("review_sla_hours", reviewSlaHours),
        updateSettingAction("default_sheet_target", defaultSheetTarget),
      ]);
      showToast("General settings saved.");
      router.refresh();
    });
  }

  // Personal profile state (for non-Owner / non-Manager team members)
  const [myName, setMyName] = useState(initialActiveMember.name || "");
  const [myTitle, setMyTitle] = useState(initialActiveMember.title || "");
  const [defaultCrmView, setDefaultCrmView] = useState<"CARDS" | "SHEET">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("astraventa_caller_default_view") as "CARDS" | "SHEET") || "CARDS";
    }
    return "CARDS";
  });

  const canManageWorkspace =
    initialActiveMember.role === "OWNER" ||
    Boolean(initialActiveMember.permissions.manageTeamAndSettings);

  function handleSaveMyProfile(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateMyProfileAction({ name: myName, title: myTitle });
      if (typeof window !== "undefined") {
        localStorage.setItem("astraventa_caller_default_view", defaultCrmView);
      }
      if (!res.ok) {
        showToast(res.error || "Could not update profile");
        return;
      }
      showToast("Your personal profile and workspace preferences have been saved.");
      router.refresh();
    });
  }

  // Filtered members
  const filteredMembers = initialMembers.filter((m) => {
    const matchesSearch =
      !searchQuery.trim() ||
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.title && m.title.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesRole = roleFilter === "ALL" || m.role === roleFilter;
    const matchesStatus = statusFilter === "ALL" || m.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const activeCount = initialMembers.filter((m) => m.status === "ACTIVE").length;
  const pendingCount = initialMembers.filter((m) => m.status === "INVITED").length;
  const scopedCount = initialMembers.filter((m) => m.nicheScope === "SELECTED").length;

  // Dedicated Personal Account Settings for Callers / Team Members
  if (!canManageWorkspace) {
    const rolePreset =
      ROLE_PRESETS[initialActiveMember.role] ?? ROLE_PRESETS.CALLER;

    return (
      <div className="space-y-6 max-w-2xl mx-auto pb-12">
        <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                Account Settings
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-zinc-400">
                Manage your personal profile and customize your Leads CRM display preferences.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-[#09090b] px-3.5 py-2 self-start sm:self-auto">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-semibold text-white">{rolePreset.label}</span>
            </div>
          </div>
        </div>

        {toastMessage && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-medium text-emerald-200">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>{toastMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-zinc-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        <form
          onSubmit={handleSaveMyProfile}
          className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-6 space-y-5"
        >
          <div className="border-b border-zinc-800/80 pb-3">
            <h2 className="text-sm font-bold text-white">Profile &amp; Calling Preferences</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Update how your name appears on call logs, notes, and follow-up schedules.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Full Display Name
              </label>
              <input
                type="text"
                required
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2 text-xs text-white focus:border-zinc-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Job Title
              </label>
              <input
                type="text"
                value={myTitle}
                onChange={(e) => setMyTitle(e.target.value)}
                placeholder="e.g., Sales Specialist"
                className="w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2 text-xs text-white focus:border-zinc-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Account Email
            </label>
            <input
              type="email"
              readOnly
              value={initialActiveMember.email}
              className="w-full rounded-lg border border-zinc-800/70 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Default Leads CRM Layout
            </label>
            <select
              value={defaultCrmView}
              onChange={(e) => setDefaultCrmView(e.target.value as "CARDS" | "SHEET")}
              className="w-full rounded-lg border border-zinc-800 bg-[#09090b] px-3 py-2 text-xs text-white focus:border-zinc-600 focus:outline-none"
            >
              <option value="CARDS">Caller Cards View (1-Click Dial &amp; Disposition)</option>
              <option value="SHEET">Table / Spreadsheet View (Inline Grid)</option>
            </select>
          </div>

          <div className="pt-2 border-t border-zinc-800/80 flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-white px-5 py-2 text-xs font-bold text-black hover:bg-zinc-200 transition disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-medium text-slate-400">{activeTenantName}</div>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              Team, Roles &amp; Workspace Settings
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Invite your team members via email, control which dashboard pages and niches each member can access, and manage workspace preferences.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Active User Badge */}
            <div className="flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-slate-400">Account:</span>
              <span className="text-xs font-semibold text-white">
                {initialActiveMember.name} ({ROLE_PRESETS[initialActiveMember.role]?.label || initialActiveMember.role})
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setCreatedInviteLink(null);
                setInviteError(null);
                setShowInviteModal(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-medium text-slate-950 shadow-sm transition hover:bg-slate-200"
            >
              <span>+ Invite Member</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-6 flex flex-wrap items-center gap-1 border-t border-slate-800/80 pt-4">
          <button
            type="button"
            onClick={() => setActiveTab("team")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
              activeTab === "team"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            }`}
          >
            <span>Team Members</span>
            <span className="rounded-full bg-slate-700/80 px-1.5 py-0.5 text-[10px] text-slate-200">
              {initialMembers.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("roles")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
              activeTab === "roles"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            }`}
          >
            <span>Roles &amp; Permissions</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("general")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
              activeTab === "general"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            }`}
          >
            <span>General Settings</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("apps")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
              activeTab === "apps"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            }`}
          >
            <span>Connected Apps</span>
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-medium text-slate-200 shadow-lg">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>{toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: TEAM MEMBERS */}
      {activeTab === "team" && (
        <div className="space-y-5">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
              <div className="text-xs text-slate-400">Total Members</div>
              <div className="mt-1.5 text-2xl font-semibold text-white">
                {initialMembers.length}
              </div>
              <div className="mt-1 text-xs text-slate-500">People in this workspace</div>
            </div>

            <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
              <div className="text-xs text-slate-400">Active Members</div>
              <div className="mt-1.5 text-2xl font-semibold text-white">{activeCount}</div>
              <div className="mt-1 text-xs text-slate-500">Currently active</div>
            </div>

            <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
              <div className="text-xs text-slate-400">Pending Invites</div>
              <div className="mt-1.5 text-2xl font-semibold text-white">{pendingCount}</div>
              <div className="mt-1 text-xs text-slate-500">Waiting to join</div>
            </div>

            <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
              <div className="text-xs text-slate-400">Specific Niche Access</div>
              <div className="mt-1.5 text-2xl font-semibold text-white">{scopedCount}</div>
              <div className="mt-1 text-xs text-slate-500">Assigned to selected niches</div>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full max-w-xs rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-slate-600 focus:outline-none"
              />

              <div className="hidden items-center gap-1 md:flex">
                {(["ALL", "OWNER", "ADMIN", "REVIEWER", "CALLER", "VIEWER"] as const).map((r) => {
                  const label = r === "ALL" ? "All Roles" : ROLE_PRESETS[r]?.label || r;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRoleFilter(r)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        roleFilter === r
                          ? "bg-slate-800 text-white"
                          : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as MemberStatus | "ALL")}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-300 focus:outline-none"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INVITED">Pending Invite</option>
                <option value="SUSPENDED">Paused</option>
              </select>
            </div>
          </div>

          {/* Members Table */}
          <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/40">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-950/40 text-[11px] font-medium text-slate-400">
                    <th className="px-5 py-3.5">Member</th>
                    <th className="px-4 py-3.5">Role</th>
                    <th className="px-4 py-3.5">Allowed Niches</th>
                    <th className="px-4 py-3.5">Dashboard Access</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredMembers.map((member) => {
                    const roleMeta = ROLE_PRESETS[member.role] ?? ROLE_PRESETS.OWNER;
                    const enabledCount = countEnabledPermissions(member.permissions);
                    const totalPerms = PERMISSION_DEFINITIONS.length;
                    const isCurrentOperator = member.id === initialActiveMember.id;

                    const allowedNichesList =
                      member.nicheScope === "ALL"
                        ? []
                        : allMarkets.filter((n) => member.allowedNicheIds.includes(n.id));

                    return (
                      <tr
                        key={member.id}
                        className={`transition hover:bg-slate-900/60 ${
                          isCurrentOperator ? "bg-slate-900/30" : ""
                        }`}
                      >
                        {/* Member Info */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                                member.avatarColor && !member.avatarColor.startsWith("from-")
                                  ? member.avatarColor
                                  : "border border-slate-700 bg-slate-800 text-slate-200"
                              }`}
                            >
                              {getInitials(member.name)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white">{member.name}</span>
                                {isCurrentOperator && (
                                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                                    Viewing Now
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-slate-400">{member.email}</div>
                              {member.title && (
                                <div className="mt-0.5 text-[11px] text-slate-500">
                                  {member.title}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Role */}
                        <td className="px-4 py-4">
                          {member.role === "OWNER" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-300">
                              <Shield className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Workspace Owner</span>
                            </span>
                          ) : (
                            <div className="flex flex-col items-start gap-1">
                              <select
                                value={member.role}
                                onChange={(e) =>
                                  handleQuickRoleChange(member, e.target.value as TeamRole)
                                }
                                disabled={isPending}
                                className={`rounded-md border px-2.5 py-1 text-xs font-medium focus:outline-none cursor-pointer ${roleMeta.badgeColor}`}
                              >
                                {ASSIGNABLE_ROLES.map((r) => (
                                  <option
                                    key={r.role}
                                    value={r.role}
                                    className="bg-slate-900 text-white"
                                  >
                                    {r.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </td>

                        {/* Allowed Niches */}
                        <td className="px-4 py-4">
                          {member.role === "OWNER" || member.nicheScope === "ALL" ? (
                            <span className="inline-flex items-center rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-xs text-slate-300">
                              All Niches ({allMarkets.length})
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1 max-w-[210px]">
                              {allowedNichesList.length > 0 ? (
                                allowedNichesList.map((n) => (
                                  <span
                                    key={n.id}
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-800/70 px-2 py-0.5 text-[11px] text-slate-200"
                                  >
                                    <span>{n.name}</span>
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-amber-400">No niches selected</span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Access Summary */}
                        <td className="px-4 py-4">
                          {member.role === "OWNER" ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400 text-xs">
                                <span>✓</span>
                                <span>Full Workspace Control (All Options)</span>
                              </span>
                              <div className="text-[11px] text-slate-400">
                                Master administrator across all niches &amp; callers
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-200">
                                  {enabledCount} of {totalPerms} options shown
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openEditDrawer(member)}
                                  className="text-xs text-sky-400 hover:text-sky-300 underline underline-offset-2"
                                >
                                  Customize
                                </button>
                              </div>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {PERMISSION_DEFINITIONS.filter((p) => member.permissions[p.key])
                                  .slice(0, 3)
                                  .map((p) => (
                                    <span
                                      key={p.key}
                                      className="rounded bg-slate-950 border border-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
                                    >
                                      {p.shortLabel}
                                    </span>
                                  ))}
                              </div>
                            </>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-4">
                          {member.status === "ACTIVE" && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Active
                            </span>
                          )}
                          {member.status === "INVITED" && (
                            <div className="flex flex-col items-start gap-1">
                              <span className="inline-flex items-center gap-1.5 text-xs text-amber-300 font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                Pending Invite
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleCopyInviteLink(member)}
                                  className="text-[11px] text-slate-400 hover:text-white underline"
                                >
                                  {copiedRowMemberId === member.id ? "✓ Copied!" : "Copy link"}
                                </button>
                                <span className="text-[10px] text-slate-600">•</span>
                                <button
                                  type="button"
                                  disabled={isSendingEmail}
                                  onClick={() => handleSendInviteEmail(member.id)}
                                  className="text-[11px] text-sky-400 hover:text-sky-300 underline font-medium disabled:opacity-50"
                                >
                                  Send email
                                </button>
                              </div>
                            </div>
                          )}
                          {member.status === "SUSPENDED" && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-rose-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                              Paused
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-4 text-right">
                          {member.role === "OWNER" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs font-medium text-slate-400">
                              <Lock className="w-3 h-3 text-slate-400" />
                              <span>Workspace Owner</span>
                            </span>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openEditDrawer(member)}
                                className="rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
                              >
                                Edit Access
                              </button>

                              <button
                                type="button"
                                onClick={() => handleRemoveMember(member)}
                                disabled={isPending}
                                className="rounded-lg px-2 py-1.5 text-xs text-slate-500 transition hover:bg-rose-950/40 hover:text-rose-300"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredMembers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">
                        No team members match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ROLES & PERMISSIONS */}
      {activeTab === "roles" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3 lg:grid-cols-5">
            {ROLE_LIST.map((r) => {
              const perms = getPermissionsForRole(r.role);
              const count = countEnabledPermissions(perms);
              return (
                <div
                  key={r.role}
                  className="flex flex-col justify-between rounded-xl border border-slate-800/80 bg-slate-900/40 p-4"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-xs font-medium ${r.badgeColor}`}
                      >
                        {r.label}
                      </span>
                      <span className="text-xs text-slate-500">{count}/8 options</span>
                    </div>
                    <p className="mt-2.5 text-xs leading-relaxed text-slate-400">{r.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/40">
            <div className="border-b border-slate-800/80 px-5 py-4">
              <h3 className="text-sm font-semibold text-white">Default Permissions by Role</h3>
              <p className="mt-0.5 text-xs text-slate-400">
                When a team member switches into the dashboard, only their enabled options appear in
                the sidebar and pages.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-950/40 text-[11px] font-medium text-slate-400">
                    <th className="px-5 py-3">Feature</th>
                    {ROLE_LIST.map((r) => (
                      <th key={r.role} className="px-4 py-3 text-center">
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {PERMISSION_DEFINITIONS.map((perm) => (
                    <tr key={perm.key} className="hover:bg-slate-900/50">
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-slate-200">{perm.label}</div>
                        <div className="mt-0.5 text-slate-400">{perm.description}</div>
                      </td>
                      {ROLE_LIST.map((r) => {
                        const allowed = getPermissionsForRole(r.role)[perm.key];
                        return (
                          <td key={r.role} className="px-4 py-3.5 text-center">
                            {allowed ? (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                                <Check className="w-3 h-3" />
                              </span>
                            ) : (
                              <span className="inline-flex h-5 w-5 items-center justify-center text-slate-600">
                                <Minus className="w-3 h-3" />
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DIALER INTEGRATION */}
      {activeTab === "dialer" && (
        <form onSubmit={handleSaveDialerSettings} className="space-y-5">
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-6 space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800/80 pb-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Connect Your Dialing Platform
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Link your separate dialer platform so callers can launch calls in 1 click and push
                  approved leads directly into your dialer campaigns.
                </p>
              </div>
              <button
                type="button"
                onClick={handleTestDialerPush}
                disabled={isPending}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white"
              >
                Send Test Lead to Dialer
              </button>
            </div>

            {/* Quick Platform Templates */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-2">
                Quick Platform Presets
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  {
                    name: "Custom Dialer Platform",
                    url: "https://dialer.yourdomain.com/call?phone={phone}&name={name}&company={company}&niche={niche}",
                  },
                  {
                    name: "GoHighLevel Dialer",
                    url: "tel:{phone}",
                  },
                  {
                    name: "VICIdial / Power Dialer",
                    url: "https://dialer.yourdomain.com/agc/api.php?phone_number={raw_phone}&vendor_lead_code={id}",
                  },
                  {
                    name: "Desktop / SIP Softphone",
                    url: "tel:{phone}",
                  },
                ].map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => {
                      setDialerPlatformName(preset.name);
                      setDialerLaunchUrl(preset.url);
                    }}
                    className={`rounded-lg border p-2.5 text-left text-xs transition ${
                      dialerPlatformName === preset.name
                        ? "border-slate-500 bg-slate-800 text-white font-medium"
                        : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Dialer Platform Name
                </label>
                <input
                  type="text"
                  value={dialerPlatformName}
                  onChange={(e) => setDialerPlatformName(e.target.value)}
                  placeholder="e.g. My Dialer Platform"
                  className="mt-1.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Shown on Dial and Send buttons in the Caller Queue and Lead Sheet.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Default Campaign / Queue Name
                </label>
                <input
                  type="text"
                  value={dialerCampaign}
                  onChange={(e) => setDialerCampaign(e.target.value)}
                  placeholder="e.g. Outbound Campaign"
                  className="mt-1.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Included when pushing leads to your dialer.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">
                1-Click Dial Launch URL
              </label>
              <input
                type="text"
                value={dialerLaunchUrl}
                onChange={(e) => setDialerLaunchUrl(e.target.value)}
                placeholder="https://your-dialer.com/call?phone={phone}&company={company}&name={name}"
                className="mt-1.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-slate-600 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Supported placeholders: <code>{"{phone}"}</code>, <code>{"{raw_phone}"}</code>,{" "}
                <code>{"{name}"}</code>, <code>{"{company}"}</code>, <code>{"{city}"}</code>,{" "}
                <code>{"{state}"}</code>, <code>{"{niche}"}</code>, <code>{"{id}"}</code>.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Dialer Webhook / API Endpoint URL (Optional)
                </label>
                <input
                  type="text"
                  value={dialerWebhookUrl}
                  onChange={(e) => setDialerWebhookUrl(e.target.value)}
                  placeholder="https://your-dialer.com/api/leads/import"
                  className="mt-1.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-slate-600 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  When you click &ldquo;Send Queue to Dialer&rdquo;, lead details are POSTed here as
                  JSON.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Dialer API Key / Token (Optional)
                </label>
                <input
                  type="password"
                  value={dialerApiKey}
                  onChange={(e) => setDialerApiKey(e.target.value)}
                  placeholder="Enter API key if required by your dialer..."
                  className="mt-1.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Sent in the <code>Authorization: Bearer</code> header.
                </p>
              </div>
            </div>

            <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 p-3.5 cursor-pointer">
              <div>
                <div className="text-xs font-medium text-white">
                  Automatically send leads to dialer when approved
                </div>
                <div className="text-[11px] text-slate-400">
                  Immediately forward newly approved leads from the Review Queue to{" "}
                  {dialerPlatformName}.
                </div>
              </div>
              <input
                type="checkbox"
                checked={dialerAutoPush}
                onChange={(e) => setDialerAutoPush(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900"
              />
            </label>

            <div className="flex items-center justify-end pt-2">
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-white px-5 py-2 text-xs font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
              >
                {isPending ? "Saving..." : "Save Dialer Settings"}
              </button>
            </div>
          </div>

          {/* Two-Way API Endpoints Reference */}
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Two-Way Sync Endpoints (For Your Dialing Platform)
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                Use these built-in endpoints in your external dialing platform to pull live leads or
                send call outcomes back into the CRM automatically.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-200">
                    1. Pull Approved Queue (GET)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/api/dialer/queue`;
                      navigator.clipboard.writeText(url);
                      showToast("Copied Queue API URL to clipboard.");
                    }}
                    className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-700"
                  >
                    Copy URL
                  </button>
                </div>
                <div className="rounded bg-slate-900 px-2.5 py-1.5 font-mono text-[11px] text-slate-300 truncate">
                  /api/dialer/queue
                </div>
                <p className="text-[11px] text-slate-500">
                  Returns callable leads for the active niche (or pass <code>?niche=hvac</code>).
                </p>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-200">
                    2. Receive Call Outcomes (POST)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/api/dialer/webhook`;
                      navigator.clipboard.writeText(url);
                      showToast("Copied Inbound Webhook URL to clipboard.");
                    }}
                    className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-700"
                  >
                    Copy URL
                  </button>
                </div>
                <div className="rounded bg-slate-900 px-2.5 py-1.5 font-mono text-[11px] text-slate-300 truncate">
                  /api/dialer/webhook
                </div>
                <p className="text-[11px] text-slate-500">
                  Accepts JSON <code>{"{ leadId, outcome, notes, nextFollowUp }"}</code> and updates
                  the CRM automatically.
                </p>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* TAB 4: GENERAL SETTINGS */}
      {activeTab === "general" && (
        <form onSubmit={handleSaveGeneralSettings} className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="space-y-4 rounded-xl border border-slate-800/80 bg-slate-900/40 p-5">
              <div>
                <h2 className="text-sm font-semibold text-white">Workspace Defaults</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Basic preferences for lead exports and activity logs.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Default Display Name
                </label>
                <input
                  value={actorName}
                  onChange={(e) => setActorName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-slate-600 focus:outline-none"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Shown on activity logs when actions are taken.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Default Google Sheet ID (Optional)
                </label>
                <input
                  value={defaultSheetTarget}
                  onChange={(e) => setDefaultSheetTarget(e.target.value)}
                  placeholder="Paste Google Spreadsheet ID..."
                  className="mt-1.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-slate-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-slate-800/80 bg-slate-900/40 p-5">
              <div>
                <h2 className="text-sm font-semibold text-white">Lead Handling Preferences</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Control how duplicate leads and saved pages are handled.
                </p>
              </div>

              <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-800/80 bg-slate-950/50 p-3.5 cursor-pointer">
                <div>
                  <div className="text-xs font-medium text-white">Block Duplicate Phone Numbers</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Automatically merge leads that share the exact same phone number.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={dedupePhoneHard}
                  onChange={(e) => setDedupePhoneHard(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
              </label>

              <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-800/80 bg-slate-950/50 p-3.5 cursor-pointer">
                <div>
                  <div className="text-xs font-medium text-white">Save Copy of Scanned Pages</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Keep a backup copy of website pages when scanning for contact details.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={saveRawSnapshots}
                  onChange={(e) => setSaveRawSnapshots(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300">
                    Keep History (Days)
                  </label>
                  <input
                    type="number"
                    value={snapshotRetentionDays}
                    onChange={(e) => setSnapshotRetentionDays(Number(e.target.value))}
                    className="mt-1.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-slate-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300">
                    Review Reminder (Hours)
                  </label>
                  <input
                    type="number"
                    value={reviewSlaHours}
                    onChange={(e) => setReviewSlaHours(Number(e.target.value))}
                    className="mt-1.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-slate-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-white px-5 py-2 text-xs font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </form>
      )}

      {/* TAB 5: CONNECTED APPS */}
      {activeTab === "apps" && (
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-5">
          <h2 className="text-sm font-semibold text-white">Connected Services</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Status of external services connected to your workspace.
          </p>

          <div className="mt-4 divide-y divide-slate-800/70">
            {requirements.map((item) => (
              <div key={item.provider} className="flex items-center justify-between py-3.5">
                <div>
                  <div className="text-xs font-medium text-white">{item.provider}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{item.message}</div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${
                    item.configured
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-800 bg-slate-950 text-slate-400"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      item.configured ? "bg-emerald-400" : "bg-slate-500"
                    }`}
                  />
                  {item.configured ? "Connected" : "Not Connected"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: INVITE MEMBER */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-base font-semibold text-white">Invite Team Member</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Add someone to your team and choose what they can access.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            {createdInviteLink ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">
                        ✓
                      </span>
                      <div className="text-sm font-semibold text-white">
                        {createdInviteLink.name} is ready to join
                      </div>
                    </div>
                    <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                      {ROLE_PRESETS[createdInviteLink.role as TeamRole]?.label || createdInviteLink.role}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    An invitation link has been generated for <span className="font-semibold text-white">{createdInviteLink.email}</span>. You can send it directly via email or copy the link below:
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isSendingEmail}
                      onClick={() => handleSendInviteEmail(createdInviteLink.memberId)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 px-3.5 py-2 text-xs font-semibold text-slate-950 transition shadow-sm"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      <span>{isSendingEmail ? "Dispatching..." : "Send Invitation Email"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (typeof navigator !== "undefined" && navigator.clipboard) {
                          navigator.clipboard.writeText(createdInviteLink.link);
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 2000);
                          showToast("Invite link copied to clipboard.");
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white hover:bg-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-950 transition shadow-sm"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
                      <span>{copiedLink ? "Copied to Clipboard!" : "Copy Invite Link"}</span>
                    </button>

                    <a
                      href={createdInviteLink.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 hover:border-slate-600 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    >
                      <span>Preview Acceptance Page ↗</span>
                    </a>
                  </div>

                  {createdInviteLink.sentDirectly && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 p-2.5 text-xs text-emerald-300 flex items-center gap-2">
                      <span>✓</span>
                      <span>Direct email delivered to {createdInviteLink.email} via Resend.</span>
                    </div>
                  )}

                  <div className="pt-2">
                    <label className="text-[11px] font-medium text-slate-400 block mb-1">
                      Direct Workspace Link:
                    </label>
                    <input
                      type="text"
                      readOnly
                      value={createdInviteLink.link}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300 select-all"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setCreatedInviteLink(null);
                      setShowInviteModal(false);
                      setCopiedLink(false);
                    }}
                    className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleInviteSubmit} className="mt-5 space-y-5">
                {inviteError && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
                    {inviteError}
                  </div>
                )}

                {/* Basic Info */}
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300">Full Name *</label>
                    <input
                      type="text"
                      required
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="e.g. Ali Raza"
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="ali@company.com"
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300">
                    Job Title (Optional)
                  </label>
                  <input
                    type="text"
                    value={inviteTitle}
                    onChange={(e) => setInviteTitle(e.target.value)}
                    placeholder="e.g. Sales Caller, Lead Researcher"
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                  />
                </div>

                {/* Role Selection */}
                <div>
                  <label className="block text-xs font-medium text-slate-300">Choose a Role</label>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {ASSIGNABLE_ROLES.map((r) => {
                      const active = inviteRole === r.role;
                      return (
                        <button
                          key={r.role}
                          type="button"
                          onClick={() => handleInviteRoleChange(r.role)}
                          className={`flex flex-col items-start rounded-lg border p-3 text-left transition ${
                            active
                              ? "border-slate-500 bg-slate-800/90"
                              : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                          }`}
                        >
                          <div className="flex w-full items-center justify-between">
                            <span className="text-xs font-semibold text-white">{r.label}</span>
                            {active && <span className="h-2 w-2 rounded-full bg-sky-400" />}
                          </div>
                          <p className="mt-1 text-[11px] text-slate-400">{r.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Allowed Niches */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs font-medium text-white">
                        Which Niches Can They Access?
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Give access to all niches or only specific ones (like HVAC or Real Estate).
                      </div>
                    </div>
                    <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5">
                      <button
                        type="button"
                        onClick={() => setInviteNicheScope("ALL")}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                          inviteNicheScope === "ALL"
                            ? "bg-slate-800 text-white"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        All Niches
                      </button>
                      <button
                        type="button"
                        onClick={() => setInviteNicheScope("SELECTED")}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                          inviteNicheScope === "SELECTED"
                            ? "bg-slate-800 text-white"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        Specific Niches
                      </button>
                    </div>
                  </div>

                  {inviteNicheScope === "SELECTED" && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {allMarkets.map((n) => {
                        const checked = inviteNicheIds.includes(n.id);
                        return (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => toggleInviteNiche(n.id)}
                            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                              checked
                                ? "border-slate-600 bg-slate-800 text-white"
                                : "border-slate-800/80 bg-slate-900/40 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <span className="truncate font-medium">{n.name}</span>
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                                checked
                                  ? "border-sky-400 bg-sky-500 text-slate-950"
                                  : "border-slate-700"
                              }`}
                            >
                              {checked ? "✓" : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Feature Permissions */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-300">
                      Dashboard Options Shown
                    </label>
                    <span className="text-[11px] text-slate-500">
                      {countEnabledPermissions(invitePerms)} of {PERMISSION_DEFINITIONS.length}{" "}
                      enabled
                    </span>
                  </div>
                  <div className="divide-y divide-slate-800/70 rounded-lg border border-slate-800 bg-slate-950/50">
                    {PERMISSION_DEFINITIONS.map((perm) => {
                      const enabled = invitePerms[perm.key];
                      return (
                        <div
                          key={perm.key}
                          onClick={() =>
                            setInvitePerms((prev) => ({
                              ...prev,
                              [perm.key]: !prev[perm.key],
                            }))
                          }
                          className="flex items-center justify-between gap-4 px-3.5 py-2.5 cursor-pointer hover:bg-slate-900/50"
                        >
                          <div>
                            <div className="text-xs font-medium text-slate-200">{perm.label}</div>
                            <div className="text-[11px] text-slate-500">{perm.description}</div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={enabled}
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                              enabled ? "bg-sky-500" : "bg-slate-800"
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                                enabled ? "translate-x-4" : "translate-x-1"
                              }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Activate immediately option */}
                <label className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-2.5 cursor-pointer">
                  <div>
                    <div className="text-xs font-medium text-slate-200">
                      Make member active right away
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Turn off if you want their status to show as &ldquo;Pending Invite&rdquo;
                      until they join.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={inviteAutoActive}
                    onChange={(e) => setInviteAutoActive(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900"
                  />
                </label>

                <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-lg bg-white px-4 py-2 text-xs font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
                  >
                    {isPending ? "Adding..." : "Send Invite"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* DRAWER: EDIT MEMBER ACCESS */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/75 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-lg flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Edit Access: {editingMember.name}
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Control which dashboard options and niches this person can see.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={handleSaveMemberEdit}
              className="flex-1 space-y-5 overflow-y-auto px-6 py-5"
            >
              {editError && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
                  {editError}
                </div>
              )}

              {/* Profile Fields */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-300">Name</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300">Email</label>
                  <input
                    type="email"
                    required
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300">Job Title</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300">Account Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as MemberStatus)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-slate-600 focus:outline-none"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="INVITED">Pending Invite</option>
                    <option value="SUSPENDED">Paused (No Access)</option>
                  </select>
                </div>
              </div>

              {/* Role Preset */}
              <div>
                <label className="block text-xs font-medium text-slate-300">Role</label>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {ASSIGNABLE_ROLES.map((r) => {
                    const active = editRole === r.role;
                    return (
                      <button
                        key={r.role}
                        type="button"
                        onClick={() => handleEditRolePreset(r.role)}
                        className={`flex flex-col items-start rounded-lg border p-2.5 text-left transition ${
                          active
                            ? "border-slate-500 bg-slate-800/90"
                            : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="text-xs font-semibold text-white">{r.label}</span>
                          {active && <span className="h-2 w-2 rounded-full bg-sky-400" />}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-400">{r.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Allowed Niches */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-white">Allowed Niches</div>
                    <div className="text-[11px] text-slate-400">
                      Choose which niches this person can view and work on.
                    </div>
                  </div>
                  <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5">
                    <button
                      type="button"
                      onClick={() => setEditNicheScope("ALL")}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        editNicheScope === "ALL"
                          ? "bg-slate-800 text-white"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      All Niches
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditNicheScope("SELECTED")}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                        editNicheScope === "SELECTED"
                          ? "bg-slate-800 text-white"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Specific Niches
                    </button>
                  </div>
                </div>

                {editNicheScope === "SELECTED" && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {allMarkets.map((n) => {
                      const checked = editNicheIds.includes(n.id);
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => toggleEditNiche(n.id)}
                          className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                            checked
                              ? "border-slate-600 bg-slate-800 text-white"
                              : "border-slate-800/80 bg-slate-900/40 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <span className="truncate font-medium">{n.name}</span>
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                              checked
                                ? "border-sky-400 bg-sky-500 text-slate-950"
                                : "border-slate-700"
                            }`}
                          >
                            {checked ? "✓" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Feature Permissions */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300">
                    Dashboard Options Shown (Permissions)
                  </label>
                  <span className="text-[11px] text-slate-500">
                    {countEnabledPermissions(editPerms)} of {PERMISSION_DEFINITIONS.length} enabled
                  </span>
                </div>
                <div className="divide-y divide-slate-800/70 rounded-lg border border-slate-800 bg-slate-950/50">
                  {PERMISSION_DEFINITIONS.map((perm) => {
                    const enabled = editPerms[perm.key];
                    return (
                      <div
                        key={perm.key}
                        onClick={() =>
                          setEditPerms((prev) => ({
                            ...prev,
                            [perm.key]: !prev[perm.key],
                          }))
                        }
                        className="flex items-center justify-between gap-4 px-3.5 py-2.5 cursor-pointer hover:bg-slate-900/50"
                      >
                        <div>
                          <div className="text-xs font-medium text-slate-200">{perm.label}</div>
                          <div className="text-[11px] text-slate-500">{perm.description}</div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                            enabled ? "bg-sky-500" : "bg-slate-800"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                              enabled ? "translate-x-4" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-800 pt-4">
                {editingMember.role !== "OWNER" ? (
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(editingMember)}
                    className="rounded-lg px-3 py-2 text-xs text-rose-400 hover:bg-rose-950/40"
                  >
                    Remove Member
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingMember(null)}
                    className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-lg bg-white px-4 py-2 text-xs font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
                  >
                    {isPending ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
