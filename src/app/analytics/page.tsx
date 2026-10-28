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
    isOwnerOrManager ? loadLeadRows(db, "approved") : Promise.resolve([]),
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

  const leadsToUse =
    isOwnerOrManager && marketLeads.length === 0 && allWorkspaceLeads.length > 0
      ? allWorkspaceLeads
      : marketLeads;

  const teamCallers = allMembers.filter(
    (m) => m.status === "ACTIVE" && m.role !== "VIEWER"
  );

  const callEvents: CallAuditEntry[] = rawAuditLogs.map((log) => {
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

  return (
    <SalesFunnelClient
      leads={leadsToUse}
      teamCallers={teamCallers}
      callEvents={callEvents}
      marketName={market.name}
      tenantName={tenant.name}
      isOwner={isOwnerOrManager}
      activeMemberName={activeMember.name}
    />
  );
}
