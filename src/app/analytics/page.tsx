import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { loadLeadRows, type LeadRow } from "@/server/repo/queue";
import { SalesFunnelClient } from "./analytics-client";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const db = await getDb();
  const [ctx, { activeMember, allMembers }] = await Promise.all([
    getActiveContext(db),
    getActiveTeamMember(db),
  ]);

  if (!canMemberAccessPath(activeMember, "/analytics")) {
    redirect(getDefaultRouteForMember(activeMember));
  }

  const { market, tenant, allMarkets } = ctx;
  const isOwnerOrManager =
    activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);

  const [marketLeads, allWorkspaceLeads] = await Promise.all([
    loadLeadRows(db, "approved", market.id),
    isOwnerOrManager ? loadLeadRows(db, "approved") : Promise.resolve([]),
  ]);

  const leadsToUse =
    isOwnerOrManager && marketLeads.length === 0 && allWorkspaceLeads.length > 0
      ? allWorkspaceLeads
      : marketLeads;

  const teamCallers = allMembers.filter(
    (m) => m.status === "ACTIVE" && m.role !== "VIEWER"
  );

  return (
    <SalesFunnelClient
      leads={leadsToUse}
      teamCallers={teamCallers}
      marketName={market.name}
      tenantName={tenant.name}
      isOwner={isOwnerOrManager}
      activeMemberName={activeMember.name}
    />
  );
}
