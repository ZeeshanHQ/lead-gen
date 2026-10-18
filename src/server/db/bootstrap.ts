/**
 * Idempotent baseline seed: structural defaults only (market, default rule,
 * settings). It never inserts companies, contacts, evidence or any prospect data.
 */
import { and, eq } from "drizzle-orm";
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
  /** Sheets writes are previewed (dry-run) until the user explicitly syncs. */
  dry_run_default: true,
  actor_name: "local-user",
  auto_approval_enabled: false,
  tenants_registry: DEFAULT_TENANTS,
  active_tenant_id: "tenant_main",
  active_market_id: "",
  team_members_registry: [],
  active_member_id: "member_owner",
  dialer_config: DEFAULT_DIALER_CONFIG,
};

export async function bootstrap(db: Db): Promise<void> {
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

    // Ensure existing market has tenantId & category in config
    const cfg = (market.config || {}) as Record<string, unknown>;
    if (!cfg.tenantId || !cfg.category) {
      await db
        .update(markets)
        .set({
          config: {
            ...cfg,
            keywords: cfg.keywords || m.keywords,
            serviceKeys: cfg.serviceKeys || m.serviceKeys,
            pageHints: cfg.pageHints || m.pageHints,
            category: cfg.category || m.category || m.key,
            icon: cfg.icon || m.icon || "building",
            tenantId: cfg.tenantId || m.tenantId || "tenant_main",
          },
        })
        .where(eq(markets.id, market.id));
    }

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

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(systemSettings).values({ key, value }).onConflictDoNothing({ target: systemSettings.key });
  }
}
