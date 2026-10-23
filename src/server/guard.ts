import type { Db } from "./db/client";
import { getActiveTeamMember } from "./repo/team";
import type { PermissionKey, TeamMember } from "./domain/team";

/** Server-side authorization. Throws a friendly error instead of trusting the UI. */
export async function requireMember(db: Db): Promise<TeamMember> {
  const { activeMember } = await getActiveTeamMember(db);
  if (activeMember.id === "guest") throw new Error("Pehle login karein.");
  return activeMember;
}

export async function requirePermission(db: Db, key: PermissionKey): Promise<TeamMember> {
  const member = await requireMember(db);
  if (!member.permissions[key]) throw new Error("Aapke paas is kaam ki ijazat nahi hai.");
  return member;
}
