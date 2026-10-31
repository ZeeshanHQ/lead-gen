import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { loadLeadRows, type LeadRow } from "@/server/repo/queue";
import { resolveGate, passesLeadRowGate, type LeadGate } from "@/server/domain/gate";
import { POST_APPROVAL } from "@/server/domain/lifecycle";
import { LeadProspector } from "./lead-prospector";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function DiscoverPage() {
  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error("DiscoverPage DB connection error:", err);
  }

  if (!db) {
    return (
      <div className="p-8 text-center text-zinc-400">
        <p className="text-base font-semibold text-white">Database Initializing</p>
        <p className="text-sm mt-1">Please reload in a moment.</p>
      </div>
    );
  }

  let activeMember;
  let allMembers: any[] = [];
  let ctx: any;

  try {
    const [contextRes, teamRes] = await Promise.all([
      getActiveContext(db),
      getActiveTeamMember(db),
    ]);
    ctx = contextRes;
    activeMember = teamRes.activeMember;
    allMembers = teamRes.allMembers || [];
  } catch (err) {
    console.error("DiscoverPage context loading error:", err);
  }

  if (!activeMember || activeMember.id === "guest") {
    redirect("/login");
  }

  if (!canMemberAccessPath(activeMember, "/discover")) {
    const fallback = getDefaultRouteForMember(activeMember);
    if (fallback !== "/discover") {
      redirect(fallback);
    }
  }

  const activeRuleConfig = (ctx?.rule?.config as any) || null;
  const activeGate = resolveGate(activeRuleConfig?.gate);
  const isOwnerOrManager =
    activeMember.role === "OWNER" || Boolean(activeMember.permissions?.manageTeamAndSettings);

  let allRows: LeadRow[] = [];
  if (ctx?.market?.id) {
    try {
      allRows = await loadLeadRows(db, "all", ctx.market.id);
    } catch (err) {
      console.warn("DiscoverPage loadLeadRows fallback:", err);
    }
  }

  const visibleRows = isOwnerOrManager
    ? allRows
    : allRows.filter((l) => l.assignedMemberId === activeMember.id);

  const postApprovalSet = new Set<string>(POST_APPROVAL as readonly string[]);
  const review = visibleRows.filter((l) => !postApprovalSet.has(l.status));
  const approved = visibleRows.filter((l) => postApprovalSet.has(l.status));

  // The Discover Prospector presents leads in staging waiting for human review & approval
  const pendingLeads = review.filter((l) => passesLeadRowGate(l, activeGate, activeRuleConfig));
  const crmReadyCount = approved.filter((l) => passesLeadRowGate(l, activeGate, activeRuleConfig)).length;

  const resolvedMarket = ctx?.market || {
    id: "default_market",
    name: "Target Industry",
    description: "Verified Lead Generation",
    keywords: ["local businesses"],
    category: "general",
  };

  return (
    <div className="space-y-6">
      <LeadProspector
        key={resolvedMarket.id}
        activeMarket={resolvedMarket}
        allMarkets={ctx?.allMarkets || [resolvedMarket]}
        initialRule={ctx?.rule?.config}
        initialGate={activeGate}
        initialLeads={pendingLeads.slice(0, 80) as any}
        initialTotalCount={pendingLeads.length}
        initialCrmReadyCount={crmReadyCount}
        canEditRules={activeMember.role === "OWNER" || Boolean(activeMember.permissions?.editRules)}
        allMembers={isOwnerOrManager ? allMembers : []}
      />
    </div>
  );
}
