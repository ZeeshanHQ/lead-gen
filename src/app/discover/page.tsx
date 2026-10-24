import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { loadLeadRows, type LeadRow } from "@/server/repo/queue";
import { resolveGate, type LeadGate } from "@/server/domain/gate";
import { LeadProspector } from "./lead-prospector";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function passesLeadRowGate(lead: LeadRow, gate: LeadGate): boolean {
  if (gate.requirePhone) {
    const phone = lead.best?.phone || lead.phoneDisplay || "";
    const digits = phone.replace(/\D/g, "");
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (national.length < 10) return false;
  }
  if (gate.requireWebsite) {
    if (!lead.website || !lead.website.trim()) return false;
  }
  if (gate.requireDecisionMaker) {
    if (!lead.owner?.name && !lead.hasDecisionMaker) return false;
  }
  if (gate.requireEmail) {
    if (!lead.best?.email || !lead.best.email.includes("@")) return false;
  }
  if (gate.requireLocation) {
    if (!lead.city || !lead.state) return false;
  }
  return true;
}

export default async function DiscoverPage() {
  const db = await getDb();
  const [ctx, { activeMember }] = await Promise.all([
    getActiveContext(db),
    getActiveTeamMember(db),
  ]);

  if (!canMemberAccessPath(activeMember, "/discover")) {
    redirect(getDefaultRouteForMember(activeMember));
  }

  const activeGate = resolveGate((ctx.rule?.config as any)?.gate);
  const [approved, review] = await Promise.all([
    loadLeadRows(db, "approved", ctx.market.id),
    loadLeadRows(db, "review", ctx.market.id),
  ]);

  const qualifiedLeads = [...approved, ...review].filter((l) => passesLeadRowGate(l, activeGate));
  const crmReadyCount = approved.filter((l) => passesLeadRowGate(l, activeGate)).length;

  return (
    <div className="space-y-6">
      <LeadProspector
        key={ctx.market.id}
        activeMarket={ctx.market}
        initialRule={ctx.rule?.config}
        initialGate={activeGate}
        initialLeads={qualifiedLeads.slice(0, 30) as any}
        initialTotalCount={qualifiedLeads.length}
        initialCrmReadyCount={crmReadyCount}
        canEditRules={activeMember.role === "OWNER" || Boolean(activeMember.permissions.editRules)}
      />
    </div>
  );
}
