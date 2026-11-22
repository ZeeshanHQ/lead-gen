/**
 * Phase 1 — Idempotent backfill script.
 *
 * Reads every row in `companies` where `next_follow_up_at IS NULL` and
 * `notes` contains a [Next Follow-up Scheduled: ...] tag.  Parses the
 * stored PKT-naive date string with the canonical `parseFollowUpMs()` helper
 * and writes the resulting UTC timestamp to `next_follow_up_at`.
 *
 * SAFE TO RE-RUN: only touches rows where `next_follow_up_at IS NULL`.
 * NEVER modifies `notes`, `updated_at`, or any other column.
 *
 * Usage:
 *   npx tsx scripts/backfill-followups.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { isNull, sql } from "drizzle-orm";
import { createDb } from "../src/server/db/client";
import { companies } from "../src/server/db/schema";
import { extractFollowUp } from "../src/server/domain/call-outcomes";
import { parseFollowUpMs } from "../src/server/domain/call-time";

const BATCH_SIZE = 100;

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "pglite://.data/pglite";
  console.log(`Connecting to: ${databaseUrl.replace(/:[^:@]+@/, ":***@")}`);

  const { db, close } = await createDb(databaseUrl);

  let offset = 0;
  let totalScanned = 0;
  let totalBackfilled = 0;
  let totalSkipped = 0;

  console.log("Starting follow-up backfill…\n");

  while (true) {
    const rows = await db
      .select({ id: companies.id, notes: companies.notes })
      .from(companies)
      .where(isNull(companies.nextFollowUpAt))
      .limit(BATCH_SIZE)
      .offset(offset);

    if (rows.length === 0) break;

    for (const row of rows) {
      totalScanned++;
      const followUpStr = extractFollowUp(row.notes);

      if (!followUpStr) {
        totalSkipped++;
        continue;
      }

      const ms = parseFollowUpMs(followUpStr);

      if (!ms) {
        console.warn(`  [SKIP] id=${row.id}  — could not parse date: "${followUpStr}"`);
        totalSkipped++;
        continue;
      }

      // Update ONLY next_follow_up_at — do NOT touch notes or updated_at
      await db.execute(
        sql`UPDATE companies SET next_follow_up_at = ${new Date(ms)} WHERE id = ${row.id}`
      );
      console.log(`  [OK]   id=${row.id}  → ${new Date(ms).toISOString()}  (from: "${followUpStr}")`);
      totalBackfilled++;
    }

    offset += BATCH_SIZE;
    if (rows.length < BATCH_SIZE) break;
  }

  await close();

  console.log("\n────────────────────────────────────────");
  console.log(`  Total scanned      : ${totalScanned}`);
  console.log(`  Backfilled         : ${totalBackfilled}`);
  console.log(`  Skipped (no tag)   : ${totalSkipped}`);
  console.log("────────────────────────────────────────");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
