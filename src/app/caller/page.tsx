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

export default async function CallerQueuePage({
  searchParams,
}: {
  searchParams?: Promise<{ caller?: string }>;
}) {
  const db = await getDb();
  const [resolvedParams, { market, allMarkets, rule }, { activeMember, allMembers }, savedDialer] =
    await Promise.all([
      searchParams ? searchParams : Promise.resolve({} as { caller?: string }),
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

  const isOwnerOrManager =
    activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);

  const marketNames: Record<string, string> = {};
  for (const m of allMarkets) {
    marketNames[m.id] = m.name;
  }

  const activeGate = (rule?.config as any)?.gate;
  const [fullQueue, customColumns] = await Promise.all([
    getCallerQueue(db, market.id, activeGate, {
      includeCrossMarketForOwner: true,
      marketNames,
    }),
    getCustomCrmColumns(db, market.id),
  ]);

  // Multi-Caller Isolation & Full Owner Transparency:
  // - OWNER / Team Managers see all leads across all callers + unassigned pool across the workspace
  // - CALLER role sees ONLY leads assigned specifically to them
  const visibleQueue = isOwnerOrManager
    ? fullQueue
    : fullQueue.filter((lead) => lead.assignedMemberId === activeMember.id);

  return (
    <CallerClient
      key={`${market.id}_${resolvedParams?.caller || "ALL"}`}
      initialQueue={visibleQueue}
      initialCallerFilter={resolvedParams?.caller || "ALL"}
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
