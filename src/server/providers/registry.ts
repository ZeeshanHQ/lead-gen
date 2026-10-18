import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { sources } from "../db/schema";
import type { DiscoveredCandidate, DiscoveryAdapter, DiscoveryQuery, ProviderMetadata } from "./types";
import { CsvAdapter } from "./csv_adapter";
import { UrlListAdapter } from "./url_list_adapter";
import { HvacDirectoryAdapter } from "./hvac_directory_adapter";
import { LicensingRegistryAdapter } from "./licensing_registry_adapter";
import { PlacesAdapter } from "./places_adapter";
import { ApolloAdapter } from "./apollo_adapter";
import { OsmHvacAdapter } from "./osm_adapter";
import { TavilyAdapter } from "./tavily_adapter";

export const BUILTIN_ADAPTERS: DiscoveryAdapter[] = [
  new CsvAdapter(),
  new UrlListAdapter(),
  new HvacDirectoryAdapter(),
  new LicensingRegistryAdapter(),
  new OsmHvacAdapter(),
  new TavilyAdapter(),
  new PlacesAdapter(),
  new ApolloAdapter(),
];

export async function ensureDefaultSources(db: Db): Promise<void> {
  for (const adapter of BUILTIN_ADAPTERS) {
    const meta = adapter.metadata;
    const isFreeLocal = !meta.requiresApiKey;
    const isConfiguredFromEnv = adapter.isConfigured({});
    const shouldEnable = isFreeLocal || isConfiguredFromEnv;

    await db
      .insert(sources)
      .values({
        key: meta.id,
        name: meta.name,
        kind: meta.category,
        enabled: shouldEnable,
        requiresApiKey: meta.requiresApiKey,
        costPerRequestUsd: meta.costPerRequestUsd,
        config: {},
      })
      .onConflictDoUpdate({
        target: sources.key,
        set: {
          name: meta.name,
          kind: meta.category,
          requiresApiKey: meta.requiresApiKey,
          costPerRequestUsd: meta.costPerRequestUsd,
          ...(isConfiguredFromEnv ? { enabled: true } : {}),
        },
      });
  }
}

export async function listProviders(db: Db): Promise<Array<ProviderMetadata & { enabled: boolean; configured: boolean; lastError: string | null }>> {
  await ensureDefaultSources(db);
  const rows = await db.select().from(sources);
  const rowMap = new Map(rows.map((r) => [r.key, r]));

  return BUILTIN_ADAPTERS.map((adapter) => {
    const row = rowMap.get(adapter.metadata.id);
    const enabled = row ? row.enabled : false;
    const config = (row?.config as Record<string, unknown>) || {};
    const configured = adapter.isConfigured(config);
    return {
      ...adapter.metadata,
      enabled,
      configured,
      lastError: row?.lastError ?? null,
    };
  });
}

export async function executeDiscovery(
  db: Db,
  query: DiscoveryQuery,
  providerFilter?: string[]
): Promise<DiscoveredCandidate[]> {
  await ensureDefaultSources(db);
  const sourceRows = await db.select().from(sources);
  const enabledSources = new Map(sourceRows.filter((s) => s.enabled).map((s) => [s.key, s]));

  const allCandidates: DiscoveredCandidate[] = [];

  const isHvacQuery =
    !query.keywords ||
    query.keywords.length === 0 ||
    query.keywords.some((k) => /hvac|air conditioning|heating|cooling|furnace|ac /i.test(k));
  const hvacOnlyAdapters = new Set(["osm_hvac", "hvac_directory", "licensing_registry"]);

  for (const adapter of BUILTIN_ADAPTERS) {
    const providerId = adapter.metadata.id;
    if (providerFilter && !providerFilter.includes(providerId)) continue;
    if (!isHvacQuery && hvacOnlyAdapters.has(providerId) && (!providerFilter || !providerFilter.includes(providerId))) {
      continue;
    }

    const sourceRecord = enabledSources.get(providerId);
    if (!sourceRecord) continue;

    const config = (sourceRecord.config as Record<string, unknown>) || {};
    if (adapter.metadata.requiresApiKey && !adapter.isConfigured(config)) {
      continue;
    }

    const start = Date.now();
    try {
      const candidates = await adapter.discover(query, config);
      const latency = Date.now() - start;

      // Update source metrics
      await db
        .update(sources)
        .set({
          requests: (sourceRecord.requests || 0) + 1,
          totalLatencyMs: (sourceRecord.totalLatencyMs || 0) + latency,
          lastSuccessAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(sources.key, providerId));

      allCandidates.push(...candidates);
    } catch (err: any) {
      const errMsg = err.message || String(err);
      await db
        .update(sources)
        .set({
          requests: (sourceRecord.requests || 0) + 1,
          errors: (sourceRecord.errors || 0) + 1,
          lastError: errMsg,
          updatedAt: new Date(),
        })
        .where(eq(sources.key, providerId));
    }
  }

  return allCandidates;
}
