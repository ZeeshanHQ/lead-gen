import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "@/server/db/client";
import { bootstrap } from "@/server/db/bootstrap";
import { parseCsvRows, mapRowToCandidate, CsvAdapter } from "@/server/providers/csv_adapter";
import { UrlListAdapter } from "@/server/providers/url_list_adapter";
import { HvacDirectoryAdapter } from "@/server/providers/hvac_directory_adapter";
import { LicensingRegistryAdapter } from "@/server/providers/licensing_registry_adapter";
import { PlacesAdapter, PLACES_PROVIDER_METADATA } from "@/server/providers/places_adapter";
import { defaultHvacRuleConfig } from "@/server/domain/rules";
import { listProviders, executeDiscovery } from "@/server/providers/registry";
import { createResearchRun, executeRun } from "@/server/research/runner";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Pluggable Source Adapters", () => {
  const rule = defaultHvacRuleConfig();
  const query = {
    rule,
    keywords: ["HVAC contractor"],
    states: ["TX"],
    cities: ["Dallas"],
    zips: [],
    limit: 10,
  };

  it("CSV Adapter parses rows and maps candidate columns accurately", async () => {
    const csvContent = `Company Name,Website,Phone,City,State
Precision Cooling,https://precisioncooling.com,(214) 710-4422,Dallas,TX
Lone Star Heat,lonestarheat.com,(817) 640-1120,Fort Worth,TX`;

    const rows = parseCsvRows(csvContent);
    expect(rows.length).toBe(2);

    const c1 = mapRowToCandidate(rows[0]!, 0);
    expect(c1).toBeDefined();
    expect(c1?.name).toBe("Precision Cooling");
    expect(c1?.website).toBe("https://precisioncooling.com");
    expect(c1?.city).toBe("Dallas");
    expect(c1?.state).toBe("TX");

    const adapter = new CsvAdapter();
    const discovered = await adapter.discover(query, { csvContent });
    expect(discovered.length).toBe(2);
  });

  it("URL List Adapter extracts clean domains and derives names", async () => {
    const adapter = new UrlListAdapter();
    const urlList = `
https://www.air-care-pros.com
summit-cooling.com/services
https://dallas-heating-air.com
`;
    const discovered = await adapter.discover(query, { urlList });
    expect(discovered.length).toBe(3);
    expect(discovered[0]!.website).toBe("https://air-care-pros.com");
    expect(discovered[0]!.name).toContain("Air Care Pros");
  });

  it("bundled sample lists are OFF by default (never mixed into real leads)", async () => {
    expect(await new HvacDirectoryAdapter().discover(query, {})).toEqual([]);
    expect(await new LicensingRegistryAdapter().discover(query, {})).toEqual([]);
  });

  it("HVAC Directory sample list works only when demo mode is explicit", async () => {
    vi.stubEnv("ENABLE_DEMO_SEED_DATA", "true");
    const discovered = await new HvacDirectoryAdapter().discover(query, {});
    expect(discovered.length).toBeGreaterThan(0);
    for (const c of discovered) {
      expect(c.state).toBe("TX");
      expect(c.provider).toBe("hvac_directory");
    }
  });

  it("Licensing sample records work only when demo mode is explicit", async () => {
    vi.stubEnv("ENABLE_DEMO_SEED_DATA", "true");
    const discovered = await new LicensingRegistryAdapter().discover(query, {});
    expect(discovered.length).toBeGreaterThan(0);
    expect(discovered[0]!.provider).toBe("licensing_registry");
    expect(discovered[0]!.providerRef).toContain("TDLR");
  });

  it("OpenStreetMap adapter queries Overpass live and maps only real tagged businesses", async () => {
    const { OsmHvacAdapter } = await import("@/server/providers/osm_adapter");
    const adapter = new OsmHvacAdapter();
    expect(adapter.metadata.category).toBe("directory");
    expect(adapter.metadata.requiresApiKey).toBe(false);
    expect(adapter.metadata.costPerRequestUsd).toBe(0);

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          elements: [
            {
              type: "node",
              id: 42,
              tags: {
                name: "Example Air",
                craft: "hvac",
                phone: "+1 214-555-0100",
                website: "https://exampleair.com",
                email: "Info@ExampleAir.com",
                "addr:housenumber": "1",
                "addr:street": "Main St",
                "addr:city": "Dallas",
                "addr:state": "TX",
                "addr:postcode": "75201",
              },
            },
            { type: "node", id: 43, tags: { craft: "hvac" } }, // no name: ignored
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const discovered = await adapter.discover(query, {});
    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({ name: "Example Air", provider: "osm_hvac", providerRef: "node_42", state: "TX", street: "1 Main St" });
    const body = String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as { body: string }).body);
    expect(decodeURIComponent(body)).toContain("US-TX");
  });

  it("OpenStreetMap adapter reports network failure instead of inventing data", async () => {
    const { OsmHvacAdapter } = await import("@/server/providers/osm_adapter");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(new OsmHvacAdapter().discover(query, {})).rejects.toThrow("OpenStreetMap query failed");
  });

  it("Google Places Adapter has strict field mask, retention policy, and compliance disclaimer", () => {
    const adapter = new PlacesAdapter();
    expect(adapter.metadata.category).toBe("places");
    expect(adapter.metadata.requiresApiKey).toBe(true);
    expect(adapter.metadata.retentionPolicyDays).toBe(30);
    expect(adapter.metadata.attributionNotice).toContain("Google Places API");
    expect(adapter.isConfigured({})).toBe(false);
  });

  it("Tavily Search Adapter generates rule-based queries, checks API key, and validates metadata", async () => {
    const { TavilyAdapter } = await import("@/server/providers/tavily_adapter");
    const adapter = new TavilyAdapter();
    expect(adapter.metadata.category).toBe("search");
    expect(adapter.metadata.requiresApiKey).toBe(true);
    expect(adapter.metadata.attributionNotice).toContain("Tavily");

    // Test query generation from saved rules
    const queries = adapter.generateQueries(query);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.length).toBeLessThanOrEqual(3);
    expect(queries[0]!.queryText).toContain("Dallas");
    expect(queries[0]!.queryText).toContain("Texas");

    // Check error when key is explicitly missing
    expect(adapter.isConfigured({ apiKey: "" })).toBe(false);
    await expect(adapter.discover(query, { apiKey: "" })).rejects.toThrow(
      "Tavily Search API key is not configured"
    );
  });
});

describe("Provider Registry & Execution", () => {
  it("lists all built-in providers with enabled and configured flags", async () => {
    const handle = await createDb("memory://");
    await bootstrap(handle.db);
    const db = handle.db;

    const providers = await listProviders(db);
    expect(providers.length).toBeGreaterThanOrEqual(5);

    const csvP = providers.find((p) => p.id === "csv_upload");
    expect(csvP?.enabled).toBe(true);
    expect(csvP?.configured).toBe(true);

    const placesP = providers.find((p) => p.id === "places");
    expect(placesP?.enabled).toBe(false);
    expect(placesP?.requiresApiKey).toBe(true);

    await handle.close();
  });
});

describe("Research Run & Job Coordinator", () => {
  it("creates a test run and runs discovery jobs with lifecycle tracking", async () => {
    // Demo sample data + no network: exercises the run lifecycle deterministically.
    vi.stubEnv("ENABLE_DEMO_SEED_DATA", "true");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    const handle = await createDb("memory://");
    await bootstrap(handle.db);
    const db = handle.db;

    const runId = await createResearchRun(db, {
      mode: "test",
      actor: "test-runner",
      maxCandidates: 2,
    });
    expect(runId).toBeDefined();

    const counters = await executeRun(db, runId, { timeoutMs: 300 });
    expect(counters.totalCandidates).toBeGreaterThan(0);
    expect(counters.completedJobs + counters.failedJobs).toBeGreaterThan(0);

    await handle.close();
  });
});
