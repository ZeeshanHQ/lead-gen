import { getDb } from "../src/server/db/client";
import { companies } from "../src/server/db/schema";
import { ilike } from "drizzle-orm";
import { deriveCallStatus } from "../src/server/domain/call-outcomes";

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

  const galveston = rows.find((r) => r.name.includes("Property Management"));
  console.log("GALVESTON RECORD:", JSON.stringify(galveston, null, 2));
  if (galveston) {
    const derived = deriveCallStatus(galveston);
    console.log("DERIVED STATUS:", JSON.stringify(derived, null, 2));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
