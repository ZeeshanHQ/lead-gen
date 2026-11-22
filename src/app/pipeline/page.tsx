import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { companies, contacts } from "@/server/db/schema";
import { desc, inArray, ne } from "drizzle-orm";
import { PipelineClient } from "./pipeline-client";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const db = await getDb();
  const { activeMember } = await getActiveTeamMember(db);

  if (!canMemberAccessPath(activeMember, "/pipeline")) {
    redirect(getDefaultRouteForMember(activeMember));
  }

  // Fetch all active deals in the pipeline
  const deals = await db
    .select()
    .from(companies)
    .where(ne(companies.dealStage, "NONE"))
    .orderBy(desc(companies.updatedAt));

  const companyIds = deals.map((c) => c.id);
  const allContacts =
    companyIds.length > 0
      ? await db
          .select()
          .from(contacts)
          .where(inArray(contacts.companyId, companyIds))
      : [];

  return (
    <PipelineClient
      initialDeals={deals}
      contacts={allContacts}
      activeMember={activeMember}
    />
  );
}
