import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { getAdminMonitorMetrics } from "@/server/repo/activities";
import { MonitorClient } from "./monitor-client";

export const dynamic = "force-dynamic";

export default async function AdminMonitorPage() {
  const db = await getDb();
  const [ctx, { activeMember, allMembers }] = await Promise.all([
    getActiveContext(db),
    getActiveTeamMember(db),
  ]);

  // Restrict to Owner / Manager (manageTeamAndSettings)
  if (!canMemberAccessPath(activeMember, "/admin/monitor")) {
    redirect(getDefaultRouteForMember(activeMember));
  }

  const metrics = await getAdminMonitorMetrics(db, ctx.market.id);

  return (
    <MonitorClient
      initialMetrics={metrics}
      marketName={ctx.market.name}
      activeMember={activeMember}
      allMembers={allMembers}
    />
  );
}
