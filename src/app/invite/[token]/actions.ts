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
    if (!member) {
      return {
        ok: false,
        error: "This invitation link is invalid or expired. Please ask your administrator to send a new invite.",
      };
    }
    if (member.status === "SUSPENDED") {
      return {
        ok: false,
        error: "This account has been deactivated by the workspace administrator.",
      };
    }
    if (await hasCredential(db, member.id)) {
      return {
        ok: false,
        error: "This invitation has already been accepted. Please sign in with your email and password.",
      };
    }

    await setPassword(db, member.id, password);
    const active = await activateMember(db, member.id);
    await audit(db, {
      actor: active.name,
      action: "team.invite_accepted",
      entityType: "team_member",
      entityId: active.id,
    });
    await startSession(active.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to accept invitation." };
  }
}
