import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { loadLeadRows, type LeadRow } from "@/server/repo/queue";
import { resolveGate, type LeadGate } from "@/server/domain/gate";
import { POST_APPROVAL } from "@/server/domain/lifecycle";
import { LeadProspector } from "./lead-prospector";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function passesLeadRowGate(lead: LeadRow, gate: LeadGate): boolean {
  if (!lead || !gate) return true;
  if (gate.requirePhone) {
    const phone = String(lead.best?.phone || lead.phoneDisplay || "");
    const digits = phone.replace(/\D/g, "");
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (national.length < 10) return false;
  }
  if (gate.requireWebsite) {
    const web = String(lead.website || "").trim();
    if (!web) return false;
  }
  if (gate.requireDecisionMaker) {
    if (!lead.owner?.name && !lead.hasDecisionMaker) return false;
  }
  if (gate.requireEmail) {
    const em = String(lead.best?.email || "");
    if (!em || !em.includes("@")) return false;
  }
  if (gate.requireLocation) {
    if (!lead.city || !lead.state) return false;
  }
  return true;
}

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

  const activeGate = resolveGate((ctx?.rule?.config as any)?.gate);
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

  const qualifiedLeads = [...review, ...approved].filter((l) => passesLeadRowGate(l, activeGate));
  const crmReadyCount = approved.filter((l) => passesLeadRowGate(l, activeGate)).length;

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
        initialLeads={qualifiedLeads.slice(0, 80) as any}
        initialTotalCount={qualifiedLeads.length}
        initialCrmReadyCount={crmReadyCount}
        canEditRules={activeMember.role === "OWNER" || Boolean(activeMember.permissions?.editRules)}
        allMembers={isOwnerOrManager ? allMembers : []}
      />
    </div>
  );
}
