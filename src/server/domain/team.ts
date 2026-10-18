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
    key: "discoverLeads",
    label: "Find & Import Leads",
    shortLabel: "Find Leads",
    description: "Search for new leads and upload CSV or Excel files.",
    category: "Leads & Calling",
  },
  {
    key: "approveLeads",
    label: "Review & Approve Leads",
    shortLabel: "Review Leads",
    description: "Check lead quality and approve or reject leads in the Review Queue.",
    category: "Leads & Calling",
  },
  {
    key: "callerWorkbench",
    label: "Call Leads & Add Notes",
    shortLabel: "Call Leads",
    description: "Open the Caller Queue, dial leads, and save call outcomes or follow-ups.",
    category: "Leads & Calling",
  },
  {
    key: "editContacts",
    label: "Edit Contact Details",
    shortLabel: "Edit Contacts",
    description: "Add or update owner names, phone numbers, and email addresses.",
    category: "Leads & Calling",
  },
  {
    key: "exportAndSync",
    label: "Export & Google Sheets",
    shortLabel: "Export & Sheets",
    description: "Download CSV files and sync approved leads to Google Sheets.",
    category: "Leads & Calling",
  },
  {
    key: "editRules",
    label: "Edit Scoring Rules",
    shortLabel: "Scoring Rules",
    description: "Change how leads are scored and filtered for each niche.",
    category: "Setup & Admin",
  },
  {
    key: "manageNiches",
    label: "Manage Niches",
    shortLabel: "Manage Niches",
    description: "Create, edit, or switch industry niches (e.g. HVAC, Real Estate, Medical).",
    category: "Setup & Admin",
  },
  {
    key: "manageTeamAndSettings",
    label: "Manage Team & Settings",
    shortLabel: "Team & Settings",
    description: "Invite team members, change permissions, and update workspace settings.",
    category: "Setup & Admin",
  },
];

export const ROLE_PRESETS: Record<TeamRole, RolePresetMeta> = {
  OWNER: {
    role: "OWNER",
    label: "Owner",
    shortLabel: "Owner",
    badgeColor: "bg-slate-100 text-slate-900 border-slate-300",
    description: "Full access to all niches, leads, team members, and settings.",
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
    description: "Can manage leads, niches, scoring rules, and team members.",
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
    description: "Can find leads, review and approve them, and sync to Google Sheets.",
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
    description: "Can call approved leads, view scripts, and save call notes and follow-ups.",
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
    description: "View-only access to the dashboard and lead lists without making changes.",
    defaultPermissions: {
      discoverLeads: false,
      approveLeads: false,
      callerWorkbench: false,
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
