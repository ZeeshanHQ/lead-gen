import { getDb } from "../src/server/db/client";
import { companies } from "../src/server/db/schema";
import { parseCallLog } from "../src/server/domain/call-outcomes";
import { ne, eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  const allDeals = await db
    .select({
      id: companies.id,
      name: companies.name,
      status: companies.status,
      dealStage: companies.dealStage,
      notes: companies.notes,
    })
    .from(companies)
    .where(ne(companies.dealStage, "NONE"));

  console.log(`Found ${allDeals.length} active deals in database.`);

  for (const deal of allDeals) {
    const logs = parseCallLog(deal.notes);
    const latestOutcome = logs[0]?.outcome;
    console.log(`Deal: "${deal.name}" (ID: ${deal.id}) | status: ${deal.status} | dealStage: ${deal.dealStage} | latestOutcome: ${latestOutcome}`);

    // If the latest outcome is NOT MEETING_BOOKED and status is not MEETING_BOOKED, sync dealStage to NONE
    if (deal.status !== "MEETING_BOOKED" && latestOutcome !== "MEETING_BOOKED") {
      console.log(`-> Syncing "${deal.name}" dealStage from ${deal.dealStage} to NONE (as status is ${deal.status})`);
      await db
        .update(companies)
        .set({
          dealStage: "NONE",
          dealValueUsd: null,
          updatedAt: new Date(),
        })
        .where(eq(companies.id, deal.id));
    }
  }

  console.log("Deal synchronization complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Sync error:", err);
  process.exit(1);
});
