import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { loadLeadRows, type LeadRow } from "@/server/repo/queue";
import { auditLogs } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { SalesFunnelClient, type CallAuditEntry } from "./analytics-client";

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

  const { market, tenant } = ctx;
  const isOwnerOrManager =
    activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);

  const [marketLeads, allWorkspaceLeads, rawAuditLogs] = await Promise.all([
    loadLeadRows(db, "approved", market.id),
    loadLeadRows(db, "approved"),
    db
      .select({
        id: auditLogs.id,
        actor: auditLogs.actor,
        companyId: auditLogs.companyId,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(eq(auditLogs.action, "caller.call_logged"))
      .orderBy(desc(auditLogs.createdAt))
      .limit(3000),
  ]);

  let leadsToUse: LeadRow[];
  if (isOwnerOrManager) {
    leadsToUse =
      marketLeads.length === 0 && allWorkspaceLeads.length > 0
        ? allWorkspaceLeads
        : marketLeads;
  } else {
    const myMarketLeads = marketLeads.filter((l) => l.assignedMemberId === activeMember.id);
    const myWorkspaceLeads = allWorkspaceLeads.filter((l) => l.assignedMemberId === activeMember.id);
    leadsToUse = myMarketLeads.length > 0 ? myMarketLeads : myWorkspaceLeads;
  }

  const teamCallers = isOwnerOrManager
    ? allMembers.filter((m) => m.status === "ACTIVE" && m.role !== "VIEWER")
    : [activeMember];

  const myLeadIdSet = new Set(leadsToUse.map((l) => l.id));
  const activeNameLower = activeMember.name.trim().toLowerCase();
  const activeEmailLower = activeMember.email.trim().toLowerCase();

  const allCallEvents: CallAuditEntry[] = rawAuditLogs.map((log) => {
    const details = (log.details as Record<string, unknown>) || {};
    return {
      id: log.id,
      actor: log.actor,
      companyId: log.companyId,
      callOutcome: String(details.callOutcome || "CALL_COMPLETED"),
      notes: typeof details.notes === "string" ? details.notes : "",
      createdAt: log.createdAt ? log.createdAt.toISOString() : new Date().toISOString(),
      painIdentified: Boolean(details.painIdentified),
    };
  });

  const callEvents = isOwnerOrManager
    ? allCallEvents
    : allCallEvents.filter((evt) => {
        const actorLower = (evt.actor || "").trim().toLowerCase();
        if (actorLower && (actorLower === activeNameLower || actorLower === activeEmailLower || actorLower.includes(activeNameLower))) {
          return true;
        }
        if (evt.companyId && myLeadIdSet.has(evt.companyId)) {
          return true;
        }
        return false;
      });

  return (
    <SalesFunnelClient
      leads={leadsToUse}
      teamCallers={teamCallers}
      callEvents={callEvents}
      marketName={market.name}
      tenantName={tenant.name}
      isOwner={isOwnerOrManager}
      activeMemberId={activeMember.id}
      activeMemberName={activeMember.name}
    />
  );
}
