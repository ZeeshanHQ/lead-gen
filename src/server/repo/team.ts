import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { systemSettings } from "../db/schema";
import {
  type TeamMember,
  type TeamRole,
  type TeamPermissions,
  type MemberStatus,
  getPermissionsForRole,
} from "../domain/team";
import { audit } from "./audit";

const AVATAR_COLORS = [
  "bg-slate-800 text-slate-100 border border-slate-700",
  "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30",
  "bg-sky-500/15 text-sky-300 border border-sky-500/30",
  "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  "bg-slate-700/60 text-slate-200 border border-slate-600/60",
];

export const DEFAULT_TEAM_MEMBERS: TeamMember[] = [
  {
    id: "member_owner",
    name: "Workspace Owner",
    email: "owner@astraventa.io",
    title: "Owner",
    role: "OWNER",
    status: "ACTIVE",
    avatarColor: "bg-slate-800 text-slate-100 border border-slate-700",
    nicheScope: "ALL",
    allowedNicheIds: [],
    tenantIds: ["tenant_main"],
    permissions: getPermissionsForRole("OWNER"),
    invitedAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: new Date().toISOString(),
  },
];

/** Used only when no valid session exists (login screens). Zero permissions. */
export const GUEST_MEMBER: TeamMember = {
  id: "guest",
  name: "Guest",
  email: "",
  title: "",
  role: "VIEWER",
  status: "INVITED",
  avatarColor: AVATAR_COLORS[0]!,
  nicheScope: "SELECTED",
  allowedNicheIds: [],
  tenantIds: [],
  permissions: getPermissionsForRole("VIEWER"),
  invitedAt: new Date(0).toISOString(),
  lastActiveAt: null,
};

async function readSettingRaw<T>(db: Db, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return row && row.value !== undefined && row.value !== null ? (row.value as T) : fallback;
}

async function writeSettingRaw(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key, value: value as never })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: value as never, updatedAt: new Date() },
    });
}

async function getMemberCookieId(): Promise<string | undefined> {
  const { getSessionMemberId } = await import("../auth");
  return (await getSessionMemberId()) ?? undefined;
}

export async function listTeamMembers(db: Db): Promise<TeamMember[]> {
  const raw = await readSettingRaw<TeamMember[]>(db, "team_members_registry", []);
  if (!Array.isArray(raw) || raw.length === 0) {
    await writeSettingRaw(db, "team_members_registry", DEFAULT_TEAM_MEMBERS);
    return DEFAULT_TEAM_MEMBERS;
  }
  return raw.map((m, idx) => {
    const isPrimaryOwner = m.id === "member_owner" || m.role === "OWNER" || idx === 0;
    return {
      ...m,
      role: isPrimaryOwner ? "OWNER" : m.role,
      status: isPrimaryOwner ? "ACTIVE" : m.status,
      nicheScope: isPrimaryOwner ? "ALL" : m.nicheScope,
      permissions: isPrimaryOwner ? getPermissionsForRole("OWNER") : m.permissions,
      title:
        m.title === "Founder & Master Admin"
          ? "Owner"
          : m.title === "Lead QA & Research Lead"
            ? "Lead Manager"
            : m.title === "Senior Outbound SDR"
              ? "Sales Caller"
              : m.title,
      avatarColor:
        !m.avatarColor || m.avatarColor.startsWith("from-")
          ? AVATAR_COLORS[idx % AVATAR_COLORS.length]!
          : m.avatarColor,
    };
  });
}

export async function touchMemberActivity(db: Db, memberId: string): Promise<void> {
  if (!memberId || memberId === "guest") return;
  const allMembers = await listTeamMembers(db);
  const target = allMembers.find((m) => m.id === memberId);
  if (!target || target.status === "SUSPENDED") return;

  const lastMs = target.lastActiveAt ? new Date(target.lastActiveAt).getTime() : 0;
  // Throttle updates: write at most once per 60 seconds
  if (Date.now() - lastMs < 60 * 1000) return;

  const nextList = allMembers.map((m) =>
    m.id === memberId ? { ...m, lastActiveAt: new Date().toISOString() } : m
  );
  await writeSettingRaw(db, "team_members_registry", nextList);
}

export async function getActiveTeamMember(db: Db): Promise<{
  activeMember: TeamMember;
  allMembers: TeamMember[];
}> {
  const allMembers = await listTeamMembers(db);
  const sessionId = await getMemberCookieId();
  const activeMember =
    allMembers.find((m) => m.id === sessionId && m.status !== "SUSPENDED") ?? GUEST_MEMBER;

  if (activeMember && activeMember.id !== "guest") {
    touchMemberActivity(db, activeMember.id).catch(() => {});
  }

  return { activeMember, allMembers };
}

export interface InviteMemberInput {
  name: string;
  email: string;
  title?: string;
  role: TeamRole;
  nicheScope: "ALL" | "SELECTED";
  allowedNicheIds?: string[];
  permissions?: Partial<TeamPermissions>;
  activateImmediately?: boolean;
}

export async function inviteTeamMember(
  db: Db,
  input: InviteMemberInput,
  actor = "local-user"
): Promise<TeamMember> {
  const cleanName = input.name.trim();
  const cleanEmail = input.email.trim().toLowerCase();

  if (cleanName.length < 2) {
    throw new Error("Team member full name is required.");
  }
  if (!cleanEmail || !cleanEmail.includes("@")) {
    throw new Error("A valid email address is required.");
  }

  const allMembers = await listTeamMembers(db);
  if (allMembers.some((m) => m.email.toLowerCase() === cleanEmail)) {
    throw new Error(`A team member with email "${cleanEmail}" already exists.`);
  }

  const basePerms = getPermissionsForRole(input.role);
  const mergedPerms: TeamPermissions = {
    ...basePerms,
    ...(input.permissions || {}),
  };

  const randomToken = `ast_inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const colorIdx = allMembers.length % AVATAR_COLORS.length;

  const newMember: TeamMember = {
    id: `member_${Date.now().toString(36)}`,
    name: cleanName,
    email: cleanEmail,
    title: input.title?.trim() || input.role,
    role: input.role,
    status: input.activateImmediately ? "ACTIVE" : "INVITED",
    avatarColor: AVATAR_COLORS[colorIdx] || "bg-slate-800 text-slate-100 border border-slate-700",
    nicheScope: input.nicheScope,
    allowedNicheIds: input.nicheScope === "SELECTED" ? input.allowedNicheIds || [] : [],
    tenantIds: ["tenant_main"],
    permissions: mergedPerms,
    inviteToken: randomToken,
    invitedBy: actor,
    invitedAt: new Date().toISOString(),
    lastActiveAt: input.activateImmediately ? new Date().toISOString() : null,
  };

  const updated = [...allMembers, newMember];
  await writeSettingRaw(db, "team_members_registry", updated);

  await audit(db, {
    actor,
    action: "team.member_invited",
    entityType: "team_member",
    entityId: newMember.id,
    newValue: {
      name: newMember.name,
      email: newMember.email,
      role: newMember.role,
      status: newMember.status,
      nicheScope: newMember.nicheScope,
      allowedNicheIds: newMember.allowedNicheIds,
      permissions: newMember.permissions,
    },
  });

  return newMember;
}

export interface UpdateMemberAccessInput {
  name?: string;
  email?: string;
  title?: string;
  role?: TeamRole;
  status?: MemberStatus;
  nicheScope?: "ALL" | "SELECTED";
  allowedNicheIds?: string[];
  permissions?: TeamPermissions;
}

export async function updateTeamMemberAccess(
  db: Db,
  memberId: string,
  input: UpdateMemberAccessInput,
  actor = "local-user"
): Promise<TeamMember> {
  const allMembers = await listTeamMembers(db);
  const existing = allMembers.find((m) => m.id === memberId);
  if (!existing) throw new Error("Team member not found.");

  // Ensure at least one OWNER remains active
  if (existing.role === "OWNER" && input.role && input.role !== "OWNER") {
    const ownerCount = allMembers.filter((m) => m.role === "OWNER" && m.status === "ACTIVE").length;
    if (ownerCount <= 1) {
      throw new Error("Cannot downgrade the last active Organization Owner.");
    }
  }

  if (existing.role === "OWNER" && input.status && input.status !== "ACTIVE") {
    const ownerCount = allMembers.filter((m) => m.role === "OWNER" && m.status === "ACTIVE").length;
    if (ownerCount <= 1) {
      throw new Error("Cannot suspend the last active Organization Owner.");
    }
  }

  const updatedMember: TeamMember = {
    ...existing,
    name: input.name !== undefined ? input.name.trim() || existing.name : existing.name,
    email: input.email !== undefined ? input.email.trim().toLowerCase() || existing.email : existing.email,
    title: input.title !== undefined ? input.title.trim() : existing.title,
    role: input.role ?? existing.role,
    status: input.status ?? existing.status,
    nicheScope: input.nicheScope ?? existing.nicheScope,
    allowedNicheIds:
      (input.nicheScope ?? existing.nicheScope) === "SELECTED"
        ? input.allowedNicheIds ?? existing.allowedNicheIds
        : [],
    permissions: input.permissions ?? existing.permissions,
    lastActiveAt:
      input.status === "ACTIVE" && existing.status !== "ACTIVE"
        ? new Date().toISOString()
        : existing.lastActiveAt,
  };

  const nextList = allMembers.map((m) => (m.id === memberId ? updatedMember : m));
  await writeSettingRaw(db, "team_members_registry", nextList);

  await audit(db, {
    actor,
    action: "team.member_access_updated",
    entityType: "team_member",
    entityId: memberId,
    oldValue: {
      role: existing.role,
      status: existing.status,
      nicheScope: existing.nicheScope,
      permissions: existing.permissions,
    },
    newValue: {
      role: updatedMember.role,
      status: updatedMember.status,
      nicheScope: updatedMember.nicheScope,
      allowedNicheIds: updatedMember.allowedNicheIds,
      permissions: updatedMember.permissions,
    },
  });

  return updatedMember;
}

export async function regenerateInviteToken(
  db: Db,
  memberId: string,
  actor = "local-user"
): Promise<{ inviteToken: string }> {
  const allMembers = await listTeamMembers(db);
  const existing = allMembers.find((m) => m.id === memberId);
  if (!existing) throw new Error("Team member not found.");

  const inviteToken = `ast_inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const nextList = allMembers.map((m) =>
    m.id === memberId ? { ...m, inviteToken, invitedAt: new Date().toISOString() } : m
  );
  await writeSettingRaw(db, "team_members_registry", nextList);

  await audit(db, {
    actor,
    action: "team.invite_resent",
    entityType: "team_member",
    entityId: memberId,
    details: { email: existing.email },
  });

  return { inviteToken };
}

export async function removeTeamMember(
  db: Db,
  memberId: string,
  actor = "local-user"
): Promise<void> {
  const allMembers = await listTeamMembers(db);
  const target = allMembers.find((m) => m.id === memberId);
  if (!target) throw new Error("Team member not found.");

  if (target.role === "OWNER") {
    const ownerCount = allMembers.filter((m) => m.role === "OWNER").length;
    if (ownerCount <= 1) {
      throw new Error("Cannot remove the primary Organization Owner.");
    }
  }

  const nextList = allMembers.filter((m) => m.id !== memberId);
  await writeSettingRaw(db, "team_members_registry", nextList);

  const savedActiveId = await readSettingRaw<string>(db, "active_member_id", "member_owner");
  if (savedActiveId === memberId) {
    const fallback = nextList[0] ?? DEFAULT_TEAM_MEMBERS[0]!;
    await writeSettingRaw(db, "active_member_id", fallback.id);
    await writeSettingRaw(db, "actor_name", fallback.name);
  }

  await audit(db, {
    actor,
    action: "team.member_removed",
    entityType: "team_member",
    entityId: memberId,
    oldValue: { name: target.name, email: target.email, role: target.role },
  });
}

export async function switchActiveMember(
  db: Db,
  memberId: string,
  actor = "local-user"
): Promise<TeamMember> {
  const allMembers = await listTeamMembers(db);
  const target = allMembers.find((m) => m.id === memberId);
  if (!target) throw new Error("Team member not found.");
  if (target.status === "SUSPENDED") {
    throw new Error("Cannot switch to a suspended team member. Reactivate their account first.");
  }

  // Mark member active and update lastActiveAt
  const updatedMember: TeamMember = {
    ...target,
    status: "ACTIVE",
    lastActiveAt: new Date().toISOString(),
  };

  const nextList = allMembers.map((m) => (m.id === memberId ? updatedMember : m));
  await writeSettingRaw(db, "team_members_registry", nextList);
  await writeSettingRaw(db, "active_member_id", updatedMember.id);
  await writeSettingRaw(db, "actor_name", `${updatedMember.name} (${updatedMember.role})`);

  await audit(db, {
    actor,
    action: "team.operator_switched",
    entityType: "team_member",
    entityId: updatedMember.id,
    details: { name: updatedMember.name, role: updatedMember.role },
  });

  return updatedMember;
}

export async function getMemberByInviteToken(
  db: Db,
  token: string
): Promise<TeamMember | null> {
  if (!token || !token.trim()) return null;
  const allMembers = await listTeamMembers(db);
  return allMembers.find((m) => m.inviteToken === token.trim()) ?? null;
}

export async function acceptTeamInvite(
  db: Db,
  token: string
): Promise<TeamMember> {
  const allMembers = await listTeamMembers(db);
  const target = allMembers.find((m) => m.inviteToken === token.trim());
  if (!target) {
    throw new Error("This invitation link is invalid or has expired.");
  }
  if (target.status === "SUSPENDED") {
    throw new Error("This team member account is currently paused by the workspace owner.");
  }

  const updatedMember: TeamMember = {
    ...target,
    status: "ACTIVE",
    lastActiveAt: new Date().toISOString(),
  };

  const nextList = allMembers.map((m) => (m.id === target.id ? updatedMember : m));
  await writeSettingRaw(db, "team_members_registry", nextList);
  await writeSettingRaw(db, "active_member_id", updatedMember.id);
  await writeSettingRaw(db, "actor_name", `${updatedMember.name} (${updatedMember.role})`);

  await audit(db, {
    actor: updatedMember.name,
    action: "team.invite_accepted",
    entityType: "team_member",
    entityId: updatedMember.id,
    details: {
      name: updatedMember.name,
      email: updatedMember.email,
      role: updatedMember.role,
    },
  });

  return updatedMember;
}


export async function findMemberByEmail(db: Db, email: string): Promise<TeamMember | null> {
  const clean = email.trim().toLowerCase();
  if (!clean) return null;
  const all = await listTeamMembers(db);
  return all.find((m) => m.email.toLowerCase() === clean) ?? null;
}

/**
 * First-run owner setup: claims the OWNER seat with real name/email and drops
 * any leftover demo members that never had credentials.
 */
export async function setupOwner(
  db: Db,
  input: { name: string; email: string }
): Promise<TeamMember> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) throw new Error("Please enter your full name.");
  if (!email.includes("@")) throw new Error("Please enter a valid email address.");

  const all = await listTeamMembers(db);
  const owner = all.find((m) => m.role === "OWNER") ?? DEFAULT_TEAM_MEMBERS[0]!;
  const updated: TeamMember = {
    ...owner,
    name,
    email,
    status: "ACTIVE",
    nicheScope: "ALL",
    allowedNicheIds: [],
    permissions: getPermissionsForRole("OWNER"),
    lastActiveAt: new Date().toISOString(),
  };
  await writeSettingRaw(db, "team_members_registry", [updated]);
  await writeSettingRaw(db, "active_member_id", updated.id);
  await writeSettingRaw(db, "actor_name", `${updated.name} (Owner)`);
  await audit(db, { actor: name, action: "team.owner_setup", entityType: "team_member", entityId: updated.id });
  return updated;
}

/** Marks an invited member active and returns them (used once a password is set). */
export async function activateMember(db: Db, memberId: string): Promise<TeamMember> {
  const all = await listTeamMembers(db);
  const target = all.find((m) => m.id === memberId);
  if (!target) throw new Error("Team member not found.");
  const updated: TeamMember = { ...target, status: "ACTIVE", inviteToken: undefined, lastActiveAt: new Date().toISOString() };
  await writeSettingRaw(db, "team_members_registry", all.map((m) => (m.id === memberId ? updated : m)));
  return updated;
}

/**
 * Register a user account: If no active credentials exist or no active owner exists,
 * initializes the user as the workspace OWNER. Otherwise, registers them as an ACTIVE member.
 */
export async function registerUser(
  db: Db,
  input: { name: string; email: string }
): Promise<TeamMember> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) throw new Error("Please enter your full name.");
  if (!email.includes("@")) throw new Error("Please enter a valid business email address.");

  const all = await listTeamMembers(db);
  const existing = all.find((m) => m.email.toLowerCase() === email);
  if (existing) {
    return existing;
  }

  // Check if an OWNER exists with active credentials
  const { hasAnyCredentials } = await import("../auth");
  const hasExistingAuth = await hasAnyCredentials(db);

  if (!hasExistingAuth) {
    // This is the first account: claim OWNER role!
    return await setupOwner(db, { name, email });
  }

  // Public self-registration is strictly disabled:
  // Only the Workspace Owner can add or invite team members.
  throw new Error(
    "Public registration is disabled. You must be invited by the Workspace Owner to access this workspace."
  );
}
