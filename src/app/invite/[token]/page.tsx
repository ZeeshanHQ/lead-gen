import React from "react";
import Link from "next/link";
import { getDb } from "@/server/db/client";
import { getMemberByInviteToken } from "@/server/repo/team";
import { getActiveContext } from "@/server/repo/markets";
import { ROLE_PRESETS, PERMISSION_DEFINITIONS } from "@/server/domain/team";
import { InviteAcceptClient } from "./invite-accept-client";
import { ShieldAlert, ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InviteTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const db = await getDb();
  const [member, ctx] = await Promise.all([
    getMemberByInviteToken(db, token),
    getActiveContext(db),
  ]);

  if (!member) {
    return (
      <div className="max-w-lg mx-auto py-16">
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/50 text-center space-y-4">
          <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center mx-auto text-slate-400">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-semibold text-white">
              Invitation Link Not Found
            </h1>
            <p className="text-xs text-slate-400">
              This invite link may have been regenerated or the member was removed by the workspace owner.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-slate-200 text-slate-950 font-semibold text-xs transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Go to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const roleMeta = ROLE_PRESETS[member.role] || ROLE_PRESETS.VIEWER;
  const assignedNiches =
    member.nicheScope === "ALL"
      ? ctx.allMarkets.map((m) => m.name)
      : ctx.allMarkets
          .filter((m) => member.allowedNicheIds.includes(m.id))
          .map((m) => m.name);

  const enabledPerms = PERMISSION_DEFINITIONS.filter(
    (p) => member.permissions[p.key]
  );

  return (
    <InviteAcceptClient
      token={token}
      member={member}
      workspaceName={ctx.tenant.name}
      roleLabel={roleMeta.label}
      assignedNiches={assignedNiches}
      enabledPermissions={enabledPerms.map((p) => p.label)}
    />
  );
}
