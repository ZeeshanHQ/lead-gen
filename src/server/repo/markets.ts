import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, markets, researchRules, systemSettings } from "../db/schema";
import { DEFAULT_TENANTS } from "../db/bootstrap";
import {
  SEEDED_MARKETS,
  createNicheRuleConfig,
} from "../domain/markets";
import { REVIEWABLE, POST_APPROVAL } from "../domain/lifecycle";
import { audit } from "./audit";
import { getActiveTeamMember } from "./team";

export interface TenantWorkspace {
  id: string;
  name: string;
  role: string;
  description?: string;
  createdAt?: string;
}

export interface MarketView {
  id: string;
  key: string;
  name: string;
  description: string;
  status: string;
  tenantId: string;
  category: string;
  icon: string;
  keywords: string[];
  leadCount: number;
  reviewCount: number;
  approvedCount: number;
}

let seededInProcess = false;

export async function ensureMarketsSeeded(db: Db): Promise<void> {
  if (seededInProcess) return;
  try {
    // Fast check: if markets already exist in DB, skip full seeding loop
    const existingRows = await db.select({ id: markets.id }).from(markets).limit(3);
    if (existingRows.length >= 3) {
      seededInProcess = true;
      return;
    }

    for (const m of SEEDED_MARKETS) {
      try {
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
      } catch {
        // Ignore duplicate key
      }

      const [market] = await db.select().from(markets).where(eq(markets.key, m.key)).limit(1);
      if (!market) continue;

      const existing = await db
        .select({ id: researchRules.id })
        .from(researchRules)
        .where(eq(researchRules.marketId, market.id))
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
    seededInProcess = true;
  } catch {
    // Ignore transient race conditions
  }
}

async function readSettingRaw<T>(db: Db, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return row && row.value !== undefined && row.value !== null ? (row.value as T) : fallback;
}

async function writeSettingRaw(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key, value: value as never })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: value as never, updatedAt: new Date() },
    });
}

export async function listTenants(db: Db): Promise<TenantWorkspace[]> {
  const raw = await readSettingRaw<TenantWorkspace[]>(db, "tenants_registry", DEFAULT_TENANTS);
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_TENANTS;
  return raw;
}

export async function listMarkets(db: Db, tenantId?: string): Promise<MarketView[]> {
  await ensureMarketsSeeded(db);

  const [rows, statusCounts] = await Promise.all([
    db.select().from(markets).where(eq(markets.status, "ACTIVE")).orderBy(asc(markets.createdAt)),
    db
      .select({
        marketId: companies.marketId,
        status: companies.status,
        n: sql<number>`count(*)::int`,
      })
      .from(companies)
      .groupBy(companies.marketId, companies.status),
  ]);

  const countMap = new Map<string, { total: number; review: number; approved: number }>();
  for (const sc of statusCounts) {
    const entry = countMap.get(sc.marketId) ?? { total: 0, review: 0, approved: 0 };
    const n = Number(sc.n);
    entry.total += n;
    if (REVIEWABLE.includes(sc.status as any)) entry.review += n;
    if (POST_APPROVAL.includes(sc.status as any)) entry.approved += n;
    countMap.set(sc.marketId, entry);
  }

  const all: MarketView[] = rows.map((r) => {
    const cfg = (r.config || {}) as Record<string, unknown>;
    const tId = typeof cfg.tenantId === "string" && cfg.tenantId ? cfg.tenantId : "tenant_main";
    const category = typeof cfg.category === "string" && cfg.category ? cfg.category : r.key;
    const icon = typeof cfg.icon === "string" && cfg.icon ? cfg.icon : "building";
    const keywords = Array.isArray(cfg.keywords) ? (cfg.keywords as string[]) : [];
    const c = countMap.get(r.id) ?? { total: 0, review: 0, approved: 0 };

    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description || "",
      status: r.status,
      tenantId: tId,
      category,
      icon,
      keywords,
      leadCount: c.total,
      reviewCount: c.review,
      approvedCount: c.approved,
    };
  });

  if (tenantId) {
    return all.filter((m) => m.tenantId === tenantId);
  }
  return all;
}

async function getCookieIds(): Promise<{ marketId?: string; tenantId?: string }> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    return {
      marketId: jar.get("astraventa_market_id")?.value,
      tenantId: jar.get("astraventa_tenant_id")?.value,
    };
  } catch {
    return {};
  }
}

export async function getActiveContext(db: Db) {
  await ensureMarketsSeeded(db);

  const [rawAllMarkets, settingsRows, cookieIds, teamCtx] = await Promise.all([
    listMarkets(db),
    db
      .select()
      .from(systemSettings)
      .where(inArray(systemSettings.key, ["tenants_registry", "active_tenant_id", "active_market_id"])),
    getCookieIds(),
    getActiveTeamMember(db),
  ]);

  const activeMember = teamCtx.activeMember;
  const isScopedMember =
    activeMember &&
    activeMember.id !== "guest" &&
    activeMember.role !== "OWNER" &&
    activeMember.nicheScope === "SELECTED" &&
    Array.isArray(activeMember.allowedNicheIds) &&
    activeMember.allowedNicheIds.length > 0;

  const scopedMarkets = isScopedMember
    ? rawAllMarkets.filter(
        (m) =>
          activeMember.allowedNicheIds.includes(m.id) ||
          activeMember.allowedNicheIds.includes(m.key)
      )
    : rawAllMarkets;

  const allMarkets = scopedMarkets.length > 0 ? scopedMarkets : rawAllMarkets;

  const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]));
  const rawTenants = settingsMap.get("tenants_registry") as TenantWorkspace[] | undefined;
  const allTenants = Array.isArray(rawTenants) && rawTenants.length > 0 ? rawTenants : DEFAULT_TENANTS;
  const savedTenantId = (settingsMap.get("active_tenant_id") as string) || "tenant_main";
  const savedMarketId = (settingsMap.get("active_market_id") as string) || "";

  const targetTenantId = cookieIds.tenantId || savedTenantId || "tenant_main";
  const tenant = allTenants.find((t) => t.id === targetTenantId) ?? allTenants[0] ?? DEFAULT_TENANTS[0]!;

  const tenantMarketsRaw = allMarkets.filter((m) => m.tenantId === tenant.id);
  const tenantMarkets = tenantMarketsRaw.length > 0 ? tenantMarketsRaw : allMarkets;

  // For scoped team members, only allow their own cookie selection within their allowed niches;
  // never fall back to the Owner's global savedMarketId if it isn't in their allowed niches.
  const targetMarketId = isScopedMember
    ? cookieIds.marketId || ""
    : cookieIds.marketId || savedMarketId;

  let market =
    tenantMarkets.find((m) => m.id === targetMarketId || m.key === targetMarketId) ??
    allMarkets.find((m) => m.id === targetMarketId || m.key === targetMarketId) ??
    tenantMarkets[0] ??
    allMarkets[0];

  if (!market) {
    const [inserted] = await db
      .insert(markets)
      .values({
        key: "hvac",
        name: "US Residential HVAC",
        description: "Residential HVAC contractors focused on replacement/installation.",
        config: {
          keywords: ["HVAC contractor", "AC replacement", "HVAC installation"],
          category: "hvac",
          tenantId: tenant.id,
        },
      })
      .returning();

    market = {
      id: inserted!.id,
      key: inserted!.key,
      name: inserted!.name,
      description: inserted!.description || "",
      status: inserted!.status,
      tenantId: tenant.id,
      category: "hvac",
      icon: "flame",
      keywords: ["HVAC contractor", "AC replacement", "HVAC installation"],
      leadCount: 0,
      reviewCount: 0,
      approvedCount: 0,
    };
  }

  // Ensure default research rule exists for this market
  const rulesForMarket = await db
    .select()
    .from(researchRules)
    .where(eq(researchRules.marketId, market.id))
    .orderBy(desc(researchRules.isDefault), desc(researchRules.updatedAt))
    .limit(1);

  let rule = rulesForMarket[0];

  if (!rule) {
    const newRuleCfg = createNicheRuleConfig({
      keywords: market.keywords.length > 0 ? market.keywords : [market.name],
      businessType: "both",
      minScore: 65,
      requiredAnyOf: market.category === "hvac" ? ["replacement", "installation"] : [],
    });
    const [createdRule] = await db
      .insert(researchRules)
      .values({
        marketId: market.id,
        name: `${market.name} — Default Qualification Rule`,
        config: newRuleCfg,
        isDefault: true,
      })
      .returning();
    rule = createdRule!;
  }

  return {
    tenant,
    market,
    rule,
    allTenants,
    tenantMarkets: tenantMarkets.length > 0 ? tenantMarkets : [market],
    allMarkets,
  };
}

export async function getActiveMarketId(db: Db): Promise<string> {
  const ctx = await getActiveContext(db);
  return ctx.market.id;
}

export async function switchActiveMarket(
  db: Db,
  marketId: string,
  actor = "local-user"
): Promise<MarketView> {
  const [allMarkets, { activeMember }] = await Promise.all([
    listMarkets(db),
    getActiveTeamMember(db),
  ]);
  const found = allMarkets.find((m) => m.id === marketId || m.key === marketId);
  if (!found) throw new Error("Target niche not found");

  if (
    activeMember &&
    activeMember.id !== "guest" &&
    activeMember.role !== "OWNER" &&
    activeMember.nicheScope === "SELECTED" &&
    activeMember.allowedNicheIds.length > 0 &&
    !activeMember.allowedNicheIds.includes(found.id) &&
    !activeMember.allowedNicheIds.includes(found.key)
  ) {
    throw new Error("You do not have access to switch to this niche.");
  }

  // Only update workspace-wide default market setting if the Workspace Owner switched it
  if (!activeMember || activeMember.role === "OWNER") {
    await Promise.all([
      writeSettingRaw(db, "active_market_id", found.id),
      writeSettingRaw(db, "active_tenant_id", found.tenantId),
    ]);
  }

  await audit(db, {
    actor: activeMember?.name || actor,
    action: "niche.switched",
    entityType: "market",
    entityId: found.id,
    details: {
      name: found.name,
      key: found.key,
      tenantId: found.tenantId,
      memberId: activeMember?.id,
      memberRole: activeMember?.role,
    },
  });

  return found;
}

export async function switchActiveTenant(
  db: Db,
  tenantId: string,
  actor = "local-user"
): Promise<{ tenant: TenantWorkspace; market: MarketView }> {
  const allTenants = await listTenants(db);
  const tenant = allTenants.find((t) => t.id === tenantId);
  if (!tenant) throw new Error("Tenant workspace not found");

  let tenantMarkets = await listMarkets(db, tenant.id);

  if (tenantMarkets.length === 0) {
    const starter = await createMarketNiche(
      db,
      {
        name: `${tenant.name.split("(")[0]?.trim() || "Primary"} — Target Niche`,
        description: `Default target niche for ${tenant.name}`,
        category: "custom",
        tenantId: tenant.id,
        keywords: ["B2B services", "local business", "commercial services"],
        businessType: "both",
        minScore: 60,
      },
      actor
    );
    tenantMarkets = [starter.market];
  }

  const firstMarket = tenantMarkets[0]!;
  await Promise.all([
    writeSettingRaw(db, "active_tenant_id", tenant.id),
    writeSettingRaw(db, "active_market_id", firstMarket.id),
  ]);

  await audit(db, {
    actor,
    action: "tenant.switched",
    entityType: "tenant",
    entityId: tenant.id,
    details: { tenantName: tenant.name, activeMarketId: firstMarket.id, activeMarketName: firstMarket.name },
  });

  return { tenant, market: firstMarket };
}

export interface CreateNicheInput {
  name: string;
  description?: string;
  category?: string;
  tenantId?: string;
  keywords?: string[];
  states?: string[];
  cities?: string[];
  businessType?: "residential" | "commercial" | "both";
  minScore?: number;
}

export async function createMarketNiche(
  db: Db,
  input: CreateNicheInput,
  actor = "local-user"
): Promise<{ market: MarketView; ruleId: string }> {
  const cleanName = input.name.trim();
  if (cleanName.length < 2) {
    throw new Error("Niche name must be at least 2 characters.");
  }

  const activeCtx = await getActiveContext(db);
  const tenantId = input.tenantId || activeCtx.tenant.id;
  const category = (input.category || "custom").toLowerCase();

  const slugBase = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const uniqueKey = `${slugBase || "niche"}_${Date.now().toString(36).slice(-4)}`;

  const keywords =
    input.keywords && input.keywords.length > 0
      ? input.keywords.map((k) => k.trim()).filter(Boolean)
      : [`${cleanName} company`, `${cleanName} services`, `local ${cleanName}`];

  const description =
    input.description?.trim() ||
    `Targeted lead discovery, qualification, and outbound CRM pipeline for ${cleanName}.`;

  const isHvac =
    category === "hvac" ||
    cleanName.toLowerCase().includes("hvac") ||
    cleanName.toLowerCase().includes("air conditioning");

  const ruleConfig = createNicheRuleConfig({
    keywords,
    businessType: input.businessType ?? "both",
    minScore: input.minScore ?? 60,
    minEmployees: 2,
    maxEmployees: 150,
    requiredAnyOf: isHvac ? ["replacement", "installation"] : [],
  });

  if (input.states && input.states.length > 0) {
    ruleConfig.geography.states = input.states.map((s) => s.trim().toUpperCase()).filter(Boolean);
  }
  if (input.cities && input.cities.length > 0) {
    ruleConfig.geography.cities = input.cities.map((c) => c.trim()).filter(Boolean);
  }

  const [marketRow] = await db
    .insert(markets)
    .values({
      key: uniqueKey,
      name: cleanName,
      description,
      status: "ACTIVE",
      config: {
        keywords,
        serviceKeys: ["replacement", "installation", "maintenance", "repair"],
        pageHints: ["services", "about", "team", "contact", "locations", "pricing", "financing"],
        category,
        icon: category,
        tenantId,
      },
    })
    .returning();

  const [ruleRow] = await db
    .insert(researchRules)
    .values({
      marketId: marketRow!.id,
      name: `${cleanName} — Qualification Rule`,
      config: ruleConfig,
      isDefault: true,
    })
    .returning();

  await Promise.all([
    writeSettingRaw(db, "active_tenant_id", tenantId),
    writeSettingRaw(db, "active_market_id", marketRow!.id),
  ]);

  await audit(db, {
    actor,
    action: "niche.created",
    entityType: "market",
    entityId: marketRow!.id,
    newValue: { name: cleanName, category, tenantId, keywords },
  });

  const marketView: MarketView = {
    id: marketRow!.id,
    key: marketRow!.key,
    name: marketRow!.name,
    description: marketRow!.description || "",
    status: marketRow!.status,
    tenantId,
    category,
    icon: category,
    keywords,
    leadCount: 0,
    reviewCount: 0,
    approvedCount: 0,
  };

  return { market: marketView, ruleId: ruleRow!.id };
}

export async function updateMarketNiche(
  db: Db,
  marketId: string,
  input: {
    name: string;
    description?: string;
    keywords?: string[];
    category?: string;
  },
  actor = "local-user"
): Promise<void> {
  const [existing] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
  if (!existing) throw new Error("Niche not found");

  const cleanName = input.name.trim();
  if (!cleanName) throw new Error("Niche name is required");

  const cfg = (existing.config || {}) as Record<string, unknown>;
  const nextKeywords =
    input.keywords && input.keywords.length > 0
      ? input.keywords.map((k) => k.trim()).filter(Boolean)
      : (cfg.keywords as string[]) || [];

  await db
    .update(markets)
    .set({
      name: cleanName,
      description: input.description?.trim() ?? existing.description,
      config: {
        ...cfg,
        keywords: nextKeywords,
        ...(input.category ? { category: input.category } : {}),
      },
      updatedAt: new Date(),
    })
    .where(eq(markets.id, marketId));

  const [ruleRow] = await db
    .select()
    .from(researchRules)
    .where(and(eq(researchRules.marketId, marketId), eq(researchRules.isDefault, true)))
    .limit(1);

  if (ruleRow && nextKeywords.length > 0) {
    const rCfg = ruleRow.config;
    await db
      .update(researchRules)
      .set({
        name: `${cleanName} — Qualification Rule`,
        config: {
          ...rCfg,
          discovery: {
            ...rCfg.discovery,
            keywords: nextKeywords,
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(researchRules.id, ruleRow.id));
  }

  await audit(db, {
    actor,
    action: "niche.updated",
    entityType: "market",
    entityId: marketId,
    newValue: { name: cleanName, keywords: nextKeywords },
  });
}

export async function deleteMarketNiche(
  db: Db,
  marketId: string,
  actor = "local-user"
): Promise<{ nextMarketId: string }> {
  const allActive = await listMarkets(db);
  if (allActive.length <= 1) {
    throw new Error("Cannot delete the only remaining active niche.");
  }

  await db
    .update(markets)
    .set({ status: "ARCHIVED", updatedAt: new Date() })
    .where(eq(markets.id, marketId));

  const remaining = allActive.filter((m) => m.id !== marketId);
  const nextMarket = remaining[0]!;
  await writeSettingRaw(db, "active_market_id", nextMarket.id);

  await audit(db, {
    actor,
    action: "niche.archived",
    entityType: "market",
    entityId: marketId,
    details: { switchedTo: nextMarket.id },
  });

  return { nextMarketId: nextMarket.id };
}

export async function createTenantWorkspace(
  db: Db,
  input: {
    name: string;
    role?: string;
    description?: string;
    initialNicheName?: string;
    initialNicheCategory?: string;
    initialNicheKeywords?: string[];
  },
  actor = "local-user"
): Promise<{ tenant: TenantWorkspace; market: MarketView }> {
  const cleanName = input.name.trim();
  if (cleanName.length < 2) throw new Error("Workspace name is required.");

  const allTenants = await listTenants(db);
  const newTenant: TenantWorkspace = {
    id: `tenant_${Date.now().toString(36)}`,
    name: cleanName,
    role: input.role?.trim() || "Workspace Owner",
    description: input.description?.trim() || "Multi-niche outbound workspace",
    createdAt: new Date().toISOString(),
  };

  const updatedTenants = [...allTenants, newTenant];
  await writeSettingRaw(db, "tenants_registry", updatedTenants);

  const nicheName = input.initialNicheName?.trim() || "US Residential HVAC";
  const { market } = await createMarketNiche(
    db,
    {
      name: nicheName,
      category: input.initialNicheCategory || "hvac",
      tenantId: newTenant.id,
      keywords: input.initialNicheKeywords,
    },
    actor
  );

  await Promise.all([
    writeSettingRaw(db, "active_tenant_id", newTenant.id),
    writeSettingRaw(db, "active_market_id", market.id),
  ]);

  await audit(db, {
    actor,
    action: "tenant.created",
    entityType: "tenant",
    entityId: newTenant.id,
    newValue: { tenant: newTenant, initialNiche: market.name },
  });

  return { tenant: newTenant, market };
}
