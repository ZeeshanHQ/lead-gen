/**
 * Idempotent baseline seed: structural defaults only (market, default rule, settings).
 * Optimized for zero-latency serverless execution: runs full seed only once per database.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { markets, researchRules, systemSettings } from "./schema";
import { SEEDED_MARKETS } from "../domain/markets";
import { DEFAULT_DIALER_CONFIG } from "../domain/dialer";

export const DEFAULT_TENANTS = [
  {
    id: "tenant_main",
    name: "Astraventa (Master Workspace)",
    role: "Organization Owner",
    description: "Primary multi-niche lead intelligence and outbound CRM workspace.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "tenant_agency",
    name: "Outbound Agency Team Alpha",
    role: "Client Campaigns",
    description: "Dedicated workspace for multi-industry outbound sales campaigns.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  stale_days: 30,
  dry_run_default: true,
  actor_name: "Workspace Owner",
  auto_approval_enabled: false,
  tenants_registry: DEFAULT_TENANTS,
  active_tenant_id: "tenant_main",
  active_market_id: "",
  team_members_registry: [],
  active_member_id: "member_owner",
  dialer_config: DEFAULT_DIALER_CONFIG,
};

let bootstrappedInProcess = false;

export async function bootstrap(db: Db): Promise<void> {
  if (bootstrappedInProcess && process.env.NODE_ENV !== "test") return;

  // Fast check: if system is already initialized, return immediately (0 latency)
  try {
    const [init] = await db
      .select({ key: systemSettings.key })
      .from(systemSettings)
      .where(eq(systemSettings.key, "system_initialized"))
      .limit(1);

    if (init) {
      bootstrappedInProcess = true;
      return;
    }
  } catch {
    // If table doesn't exist yet, proceed with full setup
  }

  // 1. Seed Markets & Default Rules
  for (const m of SEEDED_MARKETS) {
    await db
      .insert(markets)
      .values({
        key: m.key,
        name: m.name,
        description: m.description,
        config: {
          keywords: m.keywords,
          serviceKeys: m.serviceKeys,
          pageHints: m.pageHints,
          category: m.category || m.key,
          icon: m.icon || "building",
          tenantId: m.tenantId || "tenant_main",
        },
      })
      .onConflictDoNothing({ target: markets.key });

    const [market] = await db.select().from(markets).where(eq(markets.key, m.key)).limit(1);
    if (!market) continue;

    const existing = await db
      .select({ id: researchRules.id })
      .from(researchRules)
      .where(and(eq(researchRules.marketId, market.id), eq(researchRules.name, m.defaultRuleName)))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(researchRules).values({
        marketId: market.id,
        name: m.defaultRuleName,
        config: m.defaultRule(),
        isDefault: true,
      });
    }
  }

  // 2. Ensure schema columns exist
  try {
    await db.execute(sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "assigned_member_id" text;`);
    await db.execute(sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "assigned_member_name" text;`);
  } catch {}

  // 3. Ensure Row-Level Security (RLS) is enabled on all public tables (Supabase Security Advisor)
  try {
    const tablesRes = (await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `)) as any;
    const rows = tablesRes?.rows || tablesRes;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row?.table_name) {
          try {
            await db.execute(sql.raw(`ALTER TABLE public."${row.table_name}" ENABLE ROW LEVEL SECURITY;`));
          } catch {}
        }
      }
    }
  } catch {}

  // 4. Default Settings & Mark Initialized
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(systemSettings).values({ key, value }).onConflictDoNothing({ target: systemSettings.key });
  }

  await db
    .insert(systemSettings)
    .values({ key: "system_initialized", value: true })
    .onConflictDoNothing({ target: systemSettings.key });

  bootstrappedInProcess = true;
}
