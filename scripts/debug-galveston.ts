import { getDb } from "../src/server/db/client";
import { companies } from "../src/server/db/schema";
import { ilike } from "drizzle-orm";

async function main() {
  const db = await getDb();
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      status: companies.status,
      dealStage: companies.dealStage,
      notes: companies.notes,
    })
    .from(companies)
    .where(ilike(companies.name, "%Galveston%"));

  console.log("MATCHED ROWS:", JSON.stringify(rows, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
