"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getDb } from "@/server/db/client";
import { setSetting, getActor } from "@/server/repo/settings";
import {
  inviteTeamMember,
  updateTeamMemberAccess,
  regenerateInviteToken,
  removeTeamMember,
  switchActiveMember,
  acceptTeamInvite,
  type InviteMemberInput,
  type UpdateMemberAccessInput,
} from "@/server/repo/team";
import { getActiveContext, switchActiveMarket } from "@/server/repo/markets";

export async function updateSettingAction(key: string, value: unknown) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    await setSetting(db, key, value, actor);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to update setting" };
  }
}

export async function inviteTeamMemberAction(input: InviteMemberInput) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const member = await inviteTeamMember(db, input, actor);
    revalidatePath("/", "layout");
    return { ok: true, member };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to invite team member" };
  }
}

export async function updateTeamMemberAccessAction(
  memberId: string,
  input: UpdateMemberAccessInput
) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const member = await updateTeamMemberAccess(db, memberId, input, actor);
    revalidatePath("/", "layout");
    return { ok: true, member };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to update member access" };
  }
}

export async function regenerateInviteTokenAction(memberId: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { inviteToken } = await regenerateInviteToken(db, memberId, actor);
    revalidatePath("/settings");
    return { ok: true, inviteToken };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to regenerate invite link" };
  }
}

export async function removeTeamMemberAction(memberId: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    await removeTeamMember(db, memberId, actor);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to remove team member" };
  }
}

export async function switchActiveMemberAction(memberId: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const member = await switchActiveMember(db, memberId, actor);

    try {
      const jar = await cookies();
      jar.set("astraventa_member_id", member.id, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });

      // If this member has restricted niche access, ensure active market is within their allowed list
      if (member.nicheScope === "SELECTED" && member.allowedNicheIds.length > 0) {
        const ctx = await getActiveContext(db);
        if (!member.allowedNicheIds.includes(ctx.market.id)) {
          const nextMarket = await switchActiveMarket(db, member.allowedNicheIds[0]!, member.name);
          jar.set("astraventa_market_id", nextMarket.id, {
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
            sameSite: "lax",
          });
        }
      }
    } catch {
      // Safe fallback outside request cookie context
    }

    revalidatePath("/", "layout");
    return { ok: true, member };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to switch active team member" };
  }
}

export async function acceptTeamInviteAction(token: string) {
  try {
    const db = await getDb();
    const member = await acceptTeamInvite(db, token);

    try {
      const jar = await cookies();
      jar.set("astraventa_member_id", member.id, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });

      if (member.nicheScope === "SELECTED" && member.allowedNicheIds.length > 0) {
        const ctx = await getActiveContext(db);
        if (!member.allowedNicheIds.includes(ctx.market.id)) {
          const nextMarket = await switchActiveMarket(db, member.allowedNicheIds[0]!, member.name);
          jar.set("astraventa_market_id", nextMarket.id, {
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
            sameSite: "lax",
          });
        }
      }
    } catch {
      // Safe fallback outside request cookie context
    }

    revalidatePath("/", "layout");
    return { ok: true, member };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to accept invitation" };
  }
}
