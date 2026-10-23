"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { hasCredential, setPassword, startSession, validatePassword } from "@/server/auth";
import { activateMember, getMemberByInviteToken } from "@/server/repo/team";
import { audit } from "@/server/repo/audit";

export async function acceptInviteWithPasswordAction(token: string, password: string) {
  try {
    const db = await getDb();
    const pwErr = validatePassword(password);
    if (pwErr) return { ok: false, error: pwErr };

    const member = await getMemberByInviteToken(db, token);
    if (!member) return { ok: false, error: "Ye invite link invalid ya purana hai. Owner se naya link maangein." };
    if (member.status === "SUSPENDED") return { ok: false, error: "Is account ko owner ne pause kiya hua hai." };
    if (await hasCredential(db, member.id)) {
      return { ok: false, error: "Ye invite pehle use ho chuka hai. Login page se andar aayein." };
    }

    await setPassword(db, member.id, password);
    const active = await activateMember(db, member.id);
    await audit(db, { actor: active.name, action: "team.invite_accepted", entityType: "team_member", entityId: active.id });
    await startSession(active.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Invite accept nahi ho saka" };
  }
}
