import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getCallerQueue } from "@/server/repo/caller";
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
  const queue = await getCallerQueue(db, market.id, activeGate);

  return (
    <CallerClient
      key={market.id}
      initialQueue={queue}
      nicheName={market.name}
      dialerConfig={dialerConfig}
      activeActorName={activeMember.name}
      marketId={market.id}
      activeMember={activeMember}
      allMembers={allMembers}
      permissions={activeMember.permissions}
    />
  );
}
