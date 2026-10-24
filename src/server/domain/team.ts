export type TeamRole = "OWNER" | "ADMIN" | "REVIEWER" | "CALLER" | "VIEWER";

export type MemberStatus = "ACTIVE" | "INVITED" | "SUSPENDED";

export interface TeamPermissions {
  discoverLeads: boolean;
  approveLeads: boolean;
  callerWorkbench: boolean;
  editContacts: boolean;
  editRules: boolean;
  exportAndSync: boolean;
  manageNiches: boolean;
  manageTeamAndSettings: boolean;
}

export type PermissionKey = keyof TeamPermissions;

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  title: string;
  role: TeamRole;
  status: MemberStatus;
  avatarColor: string;
  nicheScope: "ALL" | "SELECTED";
  allowedNicheIds: string[];
  tenantIds: string[];
  permissions: TeamPermissions;
  inviteToken?: string;
  invitedBy?: string;
  invitedAt: string;
  lastActiveAt?: string | null;
}

export interface RolePresetMeta {
  role: TeamRole;
  label: string;
  shortLabel: string;
  badgeColor: string;
  description: string;
  defaultPermissions: TeamPermissions;
}

export const PERMISSION_DEFINITIONS: Array<{
  key: PermissionKey;
  label: string;
  shortLabel: string;
  description: string;
  category: "Leads & Calling" | "Setup & Admin";
}> = [
  {
    key: "callerWorkbench",
    label: "Leads CRM & Calling (/caller)",
    shortLabel: "Leads CRM",
    description: "Open Leads CRM, dial leads, log call outcomes, and manage scheduled follow-ups.",
    category: "Leads & Calling",
  },
  {
    key: "editContacts",
    label: "Edit CRM Leads & Pipeline",
    shortLabel: "Edit CRM",
    description: "Edit lead names, contact details, phone numbers, pipeline stages, follow-ups, and notes.",
    category: "Leads & Calling",
  },
  {
    key: "discoverLeads",
    label: "Find & Extract Leads (/discover)",
    shortLabel: "Find Leads",
    description: "Access Find Leads to run AI lead extraction and import CSV files.",
    category: "Leads & Calling",
  },
  {
    key: "approveLeads",
    label: "Overview Dashboard (/)",
    shortLabel: "Dashboard",
    description: "View the executive Overview Dashboard, pipeline KPIs, and workspace analytics.",
    category: "Leads & Calling",
  },
  {
    key: "exportAndSync",
    label: "Export CSV Files",
    shortLabel: "Export CSV",
    description: "Download qualified CRM leads as CSV spreadsheets.",
    category: "Leads & Calling",
  },
  {
    key: "editRules",
    label: "Edit Targeting & Quality Gate",
    shortLabel: "Quality Gate",
    description: "Modify Must-Have Quality Gate requirements, target locations, and ICP scoring.",
    category: "Setup & Admin",
  },
  {
    key: "manageNiches",
    label: "Switch & Manage Niches",
    shortLabel: "Switch Niches",
    description: "Show the Niche Switcher and allow creating, editing, or switching industry niches.",
    category: "Setup & Admin",
  },
  {
    key: "manageTeamAndSettings",
    label: "Team & Settings (/settings)",
    shortLabel: "Team & Settings",
    description: "Invite team members, change role permissions, and update workspace settings.",
    category: "Setup & Admin",
  },
];

export const ROLE_PRESETS: Record<TeamRole, RolePresetMeta> = {
  OWNER: {
    role: "OWNER",
    label: "Owner",
    shortLabel: "Owner",
    badgeColor: "bg-slate-100 text-slate-900 border-slate-300",
    description: "Full control over all niches, leads, quality gates, team members, and settings.",
    defaultPermissions: {
      discoverLeads: true,
      approveLeads: true,
      callerWorkbench: true,
      editContacts: true,
      editRules: true,
      exportAndSync: true,
      manageNiches: true,
      manageTeamAndSettings: true,
    },
  },
  ADMIN: {
    role: "ADMIN",
    label: "Admin",
    shortLabel: "Admin",
    badgeColor: "bg-sky-500/10 text-sky-300 border-sky-500/25",
    description: "Can manage leads, niches, quality gates, and team members.",
    defaultPermissions: {
      discoverLeads: true,
      approveLeads: true,
      callerWorkbench: true,
      editContacts: true,
      editRules: true,
      exportAndSync: true,
      manageNiches: true,
      manageTeamAndSettings: true,
    },
  },
  REVIEWER: {
    role: "REVIEWER",
    label: "Lead Manager",
    shortLabel: "Manager",
    badgeColor: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
    description: "Can find leads, manage the CRM pipeline, and view the dashboard.",
    defaultPermissions: {
      discoverLeads: true,
      approveLeads: true,
      callerWorkbench: true,
      editContacts: true,
      editRules: false,
      exportAndSync: true,
      manageNiches: false,
      manageTeamAndSettings: false,
    },
  },
  CALLER: {
    role: "CALLER",
    label: "Sales Caller",
    shortLabel: "Caller",
    badgeColor: "bg-indigo-500/10 text-indigo-300 border-indigo-500/25",
    description: "Focused CRM workspace: dial assigned leads, edit CRM records, schedule follow-ups, and log calls.",
    defaultPermissions: {
      discoverLeads: false,
      approveLeads: false,
      callerWorkbench: true,
      editContacts: true,
      editRules: false,
      exportAndSync: false,
      manageNiches: false,
      manageTeamAndSettings: false,
    },
  },
  VIEWER: {
    role: "VIEWER",
    label: "Viewer",
    shortLabel: "Viewer",
    badgeColor: "bg-slate-800/80 text-slate-300 border-slate-700/80",
    description: "Read-only access to the Leads CRM without editing or admin controls.",
    defaultPermissions: {
      discoverLeads: false,
      approveLeads: false,
      callerWorkbench: true,
      editContacts: false,
      editRules: false,
      exportAndSync: false,
      manageNiches: false,
      manageTeamAndSettings: false,
    },
  },
};

export function getPermissionsForRole(role: TeamRole): TeamPermissions {
  return { ...ROLE_PRESETS[role].defaultPermissions };
}

export function getDefaultRouteForMember(member?: TeamMember | null): string {
  if (!member) return "/login";
  if (member.role === "OWNER" || member.permissions.approveLeads) return "/";
  if (member.permissions.callerWorkbench) return "/caller";
  if (member.permissions.discoverLeads) return "/discover";
  if (member.permissions.manageTeamAndSettings) return "/settings";
  return "/caller";
}

export function canMemberAccessPath(member: TeamMember | null | undefined, pathname: string): boolean {
  if (!member) return false;
  if (member.role === "OWNER") return true;
  if (pathname === "/login" || pathname.startsWith("/invite")) return true;

  if (pathname === "/") {
    return Boolean(member.permissions.approveLeads);
  }
  if (pathname.startsWith("/discover")) {
    return Boolean(member.permissions.discoverLeads);
  }
  if (pathname.startsWith("/caller") || pathname.startsWith("/company/") || pathname.startsWith("/leads") || pathname.startsWith("/approved")) {
    return Boolean(member.permissions.callerWorkbench);
  }
  if (pathname.startsWith("/settings")) {
    return Boolean(member.permissions.manageTeamAndSettings);
  }
  if (pathname.startsWith("/rules") || pathname.startsWith("/sources") || pathname.startsWith("/runs")) {
    return Boolean(member.permissions.editRules || member.permissions.manageTeamAndSettings);
  }
  if (pathname.startsWith("/review")) {
    return Boolean(member.permissions.approveLeads || member.permissions.discoverLeads);
  }
  return Boolean(member.permissions.manageTeamAndSettings);
}
