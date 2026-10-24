import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getCallerQueue, getCustomCrmColumns } from "@/server/repo/caller";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { getSetting } from "@/server/repo/settings";
import { DEFAULT_DIALER_CONFIG, type DialerConfig } from "@/server/domain/dialer";
import { CallerClient } from "./caller-client";

export const dynamic = "force-dynamic";

export default async function CallerQueuePage() {
  const db = await getDb();
  const [{ market, rule }, { activeMember, allMembers }, savedDialer] = await Promise.all([
    getActiveContext(db),
    getActiveTeamMember(db),
    getSetting<Partial<DialerConfig>>(db, "dialer_config"),
  ]);

  if (!canMemberAccessPath(activeMember, "/caller")) {
    const fallback = getDefaultRouteForMember(activeMember);
    if (fallback !== "/caller") {
      redirect(fallback);
    }
  }

  const dialerConfig: DialerConfig = {
    ...DEFAULT_DIALER_CONFIG,
    ...(savedDialer || {}),
  };

  const activeGate = (rule?.config as any)?.gate;
  const [fullQueue, customColumns] = await Promise.all([
    getCallerQueue(db, market.id, activeGate),
    getCustomCrmColumns(db, market.id),
  ]);

  // Multi-Caller Isolation:
  // - OWNER / Team Managers see all leads across all callers + unassigned pool
  // - CALLER role sees ONLY leads assigned specifically to them
  const isOwnerOrManager =
    activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);

  const visibleQueue = isOwnerOrManager
    ? fullQueue
    : fullQueue.filter((lead) => lead.assignedMemberId === activeMember.id);

  return (
    <CallerClient
      key={market.id}
      initialQueue={visibleQueue}
      nicheName={market.name}
      nicheCategory={market.category}
      initialCustomColumns={customColumns}
      dialerConfig={dialerConfig}
      activeActorName={activeMember.name}
      marketId={market.id}
      activeMember={activeMember}
      allMembers={allMembers}
      permissions={activeMember.permissions}
    />
  );
}
