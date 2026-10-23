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
  listTeamMembers,
  type InviteMemberInput,
  type UpdateMemberAccessInput,
} from "@/server/repo/team";
import { getActiveContext, switchActiveMarket } from "@/server/repo/markets";
import { ROLE_PRESETS } from "@/server/domain/team";

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

    // Automatically send invitation email
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const emailResult = await sendTeamInviteEmailAction({ memberId: member.id });
      emailSent = Boolean(emailResult.directSent);
      if (!emailResult.ok) emailError = emailResult.error || null;
    } catch (e: any) {
      emailError = e.message;
    }

    revalidatePath("/", "layout");
    return { ok: true, member, emailSent, emailError };
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

export async function sendTeamInviteEmailAction({
  memberId,
  origin,
}: {
  memberId: string;
  origin?: string;
}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const [allMembers, ctx] = await Promise.all([
      listTeamMembers(db),
      getActiveContext(db),
    ]);
    const member = allMembers.find((m) => m.id === memberId);
    if (!member) {
      return { ok: false, error: "Team member not found" };
    }

    let token = member.inviteToken;
    if (!token) {
      const regenerated = await regenerateInviteToken(db, member.id, actor);
      token = regenerated.inviteToken;
    }

    const hostOrigin = origin || "https://leads.astraventa.com";
    const inviteUrl = `${hostOrigin}/invite/${token}`;

    const roleMeta = ROLE_PRESETS[member.role] || ROLE_PRESETS.VIEWER;
    const nicheScopeLabel =
      member.nicheScope === "ALL"
        ? "All Workspace Niches"
        : `${member.allowedNicheIds.length} Assigned Niches (${ctx.allMarkets
            .filter((m) => member.allowedNicheIds.includes(m.id))
            .map((m) => m.name)
            .join(", ") || "Specific niches"})`;

    const { sendInviteEmail } = await import("@/server/services/email");
    const result = await sendInviteEmail({
      to: member.email,
      recipientName: member.name,
      inviterName: actor || ctx.tenant.name || "Workspace Admin",
      workspaceName: ctx.tenant.name,
      roleLabel: roleMeta.label,
      nicheScopeLabel,
      inviteUrl,
    });

    return {
      ok: true,
      directSent: result.directSent,
      provider: result.provider,
      messageId: result.messageId,
      error: result.error,
      subject: result.subject,
      bodyText: result.bodyText,
      mailtoUrl: result.mailtoUrl,
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        inviteUrl,
      },
    };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to send email invite" };
  }
}
