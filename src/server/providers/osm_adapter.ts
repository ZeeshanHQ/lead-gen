import { OVERPASS_URL, buildHvacDiscoveryQuery, parseOsm, type OverpassResponse } from "../enrichment/osm";
import type { DiscoveredCandidate, DiscoveryAdapter, DiscoveryQuery, ProviderMetadata } from "./types";

export const OSM_HVAC_METADATA: ProviderMetadata = {
  id: "osm_hvac",
  name: "OpenStreetMap Open Registry (live)",
  category: "directory",
  description:
    "Live query of the free OpenStreetMap Overpass API for HVAC businesses (craft=hvac / shop=hvac). Real records only; coverage depends on community mapping.",
  requiresApiKey: false,
  attributionNotice: "© OpenStreetMap contributors (ODbL)",
  costPerRequestUsd: 0,
};

export class OsmHvacAdapter implements DiscoveryAdapter {
  metadata = OSM_HVAC_METADATA;

  isConfigured(_config: Record<string, unknown>): boolean {
    return true;
  }

  async discover(query: DiscoveryQuery, _config: Record<string, unknown>): Promise<DiscoveredCandidate[]> {
    const overpass = buildHvacDiscoveryQuery({ states: query.states ?? [], cities: query.cities ?? [], limit: query.limit });
    let json: OverpassResponse | null = null;
    try {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "AstraventaLeadResearch/1.0" },
        body: `data=${encodeURIComponent(overpass)}`,
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      json = (await res.json()) as OverpassResponse;
    } catch (err) {
      // Surface the failure to the registry so it shows up as the source's lastError.
      throw new Error(`OpenStreetMap query failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return parseOsm(json)
      .slice(0, query.limit)
      .map(
        (b): DiscoveredCandidate => ({
          name: b.name,
          website: b.website,
          phone: b.phone,
          street: b.street,
          city: b.city,
          state: b.state,
          zip: b.zip,
          provider: "osm_hvac",
          providerRef: b.ref.replace("/", "_"),
          sourceUrl: `https://www.openstreetmap.org/${b.ref}`,
          rawPayload: { ...b },
        }),
      );
  }
}
