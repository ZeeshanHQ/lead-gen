/**
 * Applies migrations and the baseline seed to DATABASE_URL.
 * Usage: npm run db:migrate
 */
import { config } from "dotenv";
import { createDb } from "../src/server/db/client";
import { bootstrap } from "../src/server/db/bootstrap";
import { parseEnv } from "../src/server/env";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const env = parseEnv(process.env);
  const redacted = env.DATABASE_URL.replace(/:\/\/([^:@/]+):[^@]+@/, "://$1:***@");
  console.log(`Migrating ${redacted} ...`);
  const handle = await createDb(env.DATABASE_URL);
  await bootstrap(handle.db);
  await handle.close();
  console.log(`Done (driver: ${handle.driver}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
