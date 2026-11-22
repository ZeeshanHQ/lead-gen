import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { companies, contacts, auditLogs } from "@/server/db/schema";
import { desc, inArray, ne, eq } from "drizzle-orm";
import { loadLeadRows, type LeadRow } from "@/server/repo/queue";
import { PipelineClient } from "./pipeline-client";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const db = await getDb();
  const [ctx, { activeMember, allMembers }] = await Promise.all([
    getActiveContext(db),
    getActiveTeamMember(db),
  ]);

  if (!canMemberAccessPath(activeMember, "/pipeline")) {
    redirect(getDefaultRouteForMember(activeMember));
  }

  const { market, tenant } = ctx;
  const isOwnerOrManager =
    activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);

  const [deals, marketLeads, allWorkspaceLeads, rawAuditLogs] = await Promise.all([
    db
      .select()
      .from(companies)
      .where(ne(companies.dealStage, "NONE"))
      .orderBy(desc(companies.updatedAt)),
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

  const companyIds = deals.map((c) => c.id);
  const allContacts =
    companyIds.length > 0
      ? await db
          .select()
          .from(contacts)
          .where(inArray(contacts.companyId, companyIds))
      : [];

  const leadsToUse =
    isOwnerOrManager && allWorkspaceLeads.length > 0 ? allWorkspaceLeads : marketLeads;

  const sp = searchParams ? await searchParams : {};
  const initialTab = sp?.tab === "analytics" ? "ANALYTICS" : "PIPELINE";

  return (
    <PipelineClient
      initialDeals={deals}
      contacts={allContacts}
      activeMember={activeMember}
      leads={leadsToUse}
      teamCallers={allMembers}
      callEvents={rawAuditLogs}
      marketName={market.name}
      tenantName={tenant.name}
      initialTab={initialTab}
    />
  );
}
