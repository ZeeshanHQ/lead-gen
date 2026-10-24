/**
 * Database client. One Drizzle schema, two drivers:
 *   pglite://<dir>      embedded PostgreSQL (local default, single process)
 *   memory://           in-memory PGlite (tests)
 *   postgres(ql)://...  node-postgres (Supabase / Neon / any Postgres)
 */
import os from "node:os";
import path from "node:path";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

export interface DbHandle {
  db: Db;
  driver: "pglite" | "memory" | "pg";
  close: () => Promise<void>;
}

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");
let migratedPgInProcess = false;

function isLocalPostgresHost(connectionString: string): boolean {
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export async function createDb(url: string): Promise<DbHandle> {
  if (url.startsWith("pglite://") || url.startsWith("memory://")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");

    const isMemory = url.startsWith("memory://");
    const rawRelPath = url.slice("pglite://".length);

    const isServerlessReadOnly = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const dir = isMemory
      ? undefined
      : isServerlessReadOnly
        ? path.join(os.tmpdir(), "astraventa-pglite")
        : path.resolve(/*turbopackIgnore: true*/ process.cwd(), rawRelPath);

    if (dir) {
      const fs = await import("node:fs");
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      const pidFile = path.join(dir, "postmaster.pid");
      if (fs.existsSync(pidFile)) {
        try {
          fs.unlinkSync(pidFile);
        } catch {}
      }
    }

    const client = dir ? new PGlite(dir) : new PGlite();
    await client.waitReady;
    const db = drizzle({ client, schema });
    try {
      const fsModule = await import("node:fs");
      if (fsModule.existsSync(MIGRATIONS_FOLDER)) {
        await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      } else {
        const { SCHEMA_DDL } = await import("./ddl");
        await client.exec(SCHEMA_DDL);
      }
    } catch (mErr) {
      console.warn("PGlite migration/DDL fallback warning:", mErr);
    }
    return {
      db: db as unknown as Db,
      driver: isMemory ? "memory" : "pglite",
      close: () => client.close(),
    };
  }

  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");

  // In Supabase, port 5432 is SESSION mode (strictly capped to 15 connections max for whole DB).
  // Port 6543 is TRANSACTION mode (built for serverless / Vercel, supports thousands of connections).
  // Automatically rewrite port 5432 to 6543 for Supabase pooler connections.
  let connString = url.trim();
  if (connString.includes("pooler.supabase.com:5432")) {
    connString = connString.replace(":5432", ":6543");
  }

  const useSsl = !isLocalPostgresHost(connString) && !connString.includes("sslmode=disable");
  const pool = new Pool({
    connectionString: connString,
    max: process.env.VERCEL ? 6 : 12,
    idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
    connectionTimeoutMillis: 15_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  const db = drizzle({ client: pool, schema });

  if (!migratedPgInProcess) {
    try {
      const { sql } = await import("drizzle-orm");
      // Fast check: if system_settings table already exists, skip heavy DDL migrator on cold start
      await db.execute(sql`SELECT 1 FROM "system_settings" LIMIT 1`);
      migratedPgInProcess = true;
    } catch {
      try {
        const { migrate } = await import("drizzle-orm/node-postgres/migrator");
        const fsModule = await import("node:fs");
        if (fsModule.existsSync(MIGRATIONS_FOLDER)) {
          await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
        }
        migratedPgInProcess = true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("Postgres migration skipped or warning:", msg);
        migratedPgInProcess = true;
      }
    }
  }

  return { db: db as unknown as Db, driver: "pg", close: () => pool.end() };
}

// ---- process-wide singleton (survives Next.js dev hot reloads) ---------------

interface GlobalWithDb {
  __astraDb?: Promise<DbHandle>;
}
const g = globalThis as unknown as GlobalWithDb;

export function getDbHandle(): Promise<DbHandle> {
  if (!g.__astraDb) {
    g.__astraDb = (async () => {
      const { getEnv } = await import("../env");
      const { bootstrap } = await import("./bootstrap");
      const handle = await createDb(getEnv().DATABASE_URL);
      await bootstrap(handle.db);
      return handle;
    })();
    // If startup fails, allow a retry on the next call instead of caching the failure.
    g.__astraDb.catch(() => {
      g.__astraDb = undefined;
    });
  }
  return g.__astraDb;
}

export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}
