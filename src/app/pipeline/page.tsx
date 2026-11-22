import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { companies, contacts, auditLogs, leadScores } from "@/server/db/schema";
import { desc, inArray, ne, eq, and } from "drizzle-orm";
import { POST_APPROVAL, type LifecycleStatus } from "@/server/domain/lifecycle";
import { pickBestContact } from "@/server/domain/contact";
import type { LeadRow } from "@/server/repo/queue";
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

  // High-performance lean queries for Pipeline & Funnel:
  // Directly loads targeted fields needed for Pipeline and Funnel Analytics without
  // running multi-table joins or duplicate queue calculations.
  const [deals, companyRows, scoresRows, rawAuditLogs] = await Promise.all([
    db
      .select()
      .from(companies)
      .where(ne(companies.dealStage, "NONE"))
      .orderBy(desc(companies.updatedAt)),
    db
      .select({
        id: companies.id,
        name: companies.name,
        city: companies.city,
        state: companies.state,
        status: companies.status,
        facts: companies.facts,
        notes: companies.notes,
        assignedMemberId: companies.assignedMemberId,
        assignedMemberName: companies.assignedMemberName,
        qualificationStatus: companies.qualificationStatus,
        dealStage: companies.dealStage,
        dealValueUsd: companies.dealValueUsd,
        createdAt: companies.createdAt,
        updatedAt: companies.updatedAt,
        phoneDisplay: companies.phoneDisplay,
        website: companies.website,
      })
      .from(companies)
      .where(
        isOwnerOrManager
          ? inArray(companies.status, POST_APPROVAL)
          : and(eq(companies.marketId, market.id), inArray(companies.status, POST_APPROVAL))
      )
      .orderBy(desc(companies.createdAt)),
    db
      .select({
        companyId: leadScores.companyId,
        icpScore: leadScores.icpScore,
      })
      .from(leadScores)
      .where(eq(leadScores.status, "CURRENT")),
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
      .limit(1500),
  ]);

  const companyIds = deals.map((c) => c.id);
  const allContacts =
    companyIds.length > 0
      ? await db
          .select()
          .from(contacts)
          .where(inArray(contacts.companyId, companyIds))
      : [];

  const scoreMap = new Map<string, number | null>();
  for (const s of scoresRows) {
    scoreMap.set(s.companyId, s.icpScore ?? null);
  }

  const leadsToUse: LeadRow[] = companyRows.map((r): LeadRow => ({
    id: r.id,
    name: r.name,
    address: null,
    city: r.city,
    state: r.state,
    website: r.website,
    domain: null,
    status: r.status as LifecycleStatus,
    phoneDisplay: r.phoneDisplay,
    facts: (r.facts as Record<string, unknown>) ?? {},
    icpScore: scoreMap.get(r.id) ?? null,
    researchConfidence: null,
    grade: null,
    owner: null,
    best: pickBestContact([], r.phoneDisplay),
    hasDecisionMaker: false,
    hasDirectContact: false,
    evidenceCount: 0,
    lastVerifiedAt: null,
    stale: false,
    neverVerified: false,
    discoveredVia: "",
    sources: [],
    researchSummary: null,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    approvedAt: null,
    assignedMemberId: r.assignedMemberId,
    assignedMemberName: r.assignedMemberName,
    qualificationStatus: r.qualificationStatus,
    dealStage: r.dealStage,
    dealValueUsd: r.dealValueUsd,
  }));

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
