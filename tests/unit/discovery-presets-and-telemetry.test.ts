import { describe, it, expect } from "vitest";
import {
  getFilteredPresetsForMarket,
  ALL_INTENT_PRESETS,
} from "@/app/discover/presets";
import {
  recordRunTelemetry,
  getRunTelemetry,
  clearRunTelemetry,
} from "@/server/research/telemetry";

describe("Dynamic Niche Presets & Zero-Dump Filtering", () => {
  it("filters presets strictly for Real Estate & STR markets", () => {
    const realEstateMarket = {
      id: "realestate_market",
      name: "Real Estate & Property Management",
      category: "realestate",
      keywords: ["real estate brokerage", "property management company", "vacation rentals"],
    };

    const presets = getFilteredPresetsForMarket(realEstateMarket);

    // Verify all returned presets belong to realestate or airbnb_str
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.every((p) => p.category === "realestate" || p.category === "airbnb_str")).toBe(true);

    // Verify off-niche presets are NOT present
    expect(presets.some((p) => p.category === "hvac")).toBe(false);
    expect(presets.some((p) => p.category === "medical")).toBe(false);
    expect(presets.some((p) => p.category === "dental")).toBe(false);

    // Verify professional STR and MTR presets exist
    const vrm = presets.find((p) => p.id === "str_vrm_concierge");
    expect(vrm).toBeDefined();
    expect(vrm?.minDoors).toBe(15);
    expect(vrm?.customMustHaves).toContain("15+ Doors Managed");
    expect(vrm?.negativeKeywords).toContain("casual host");
    expect(vrm?.negativeKeywords).toContain("spare room");

    const mtr = presets.find((p) => p.id === "corporate_midterm_housing");
    expect(mtr).toBeDefined();
    expect(mtr?.subNiche).toBe("corporate_housing_mtr");

    const cohost = presets.find((p) => p.id === "str_cohosting_boutique");
    expect(cohost).toBeDefined();

    const commercial = presets.find((p) => p.id === "commercial_re_cre");
    expect(commercial).toBeDefined();
    expect(commercial?.businessType).toBe("commercial");
  });

  it("filters presets strictly for HVAC market without real estate leaks", () => {
    const hvacMarket = {
      id: "hvac_market",
      name: "Residential HVAC",
      category: "hvac",
      keywords: ["HVAC contractor", "AC replacement"],
    };

    const presets = getFilteredPresetsForMarket(hvacMarket);

    expect(presets.length).toBeGreaterThan(0);
    expect(presets.every((p) => p.category === "hvac")).toBe(true);
    expect(presets.some((p) => p.category === "realestate")).toBe(false);
    expect(presets.some((p) => p.category === "airbnb_str")).toBe(false);
  });

  it("filters presets strictly for Medical market", () => {
    const medicalMarket = {
      id: "medical_market",
      name: "Medical Clinics & Practices",
      category: "medical",
      keywords: ["private medical clinic"],
    };

    const presets = getFilteredPresetsForMarket(medicalMarket);

    expect(presets.length).toBeGreaterThan(0);
    expect(presets.every((p) => p.category === "medical" || p.category === "dental")).toBe(true);
    expect(presets.some((p) => p.category === "realestate")).toBe(false);
    expect(presets.some((p) => p.category === "hvac")).toBe(false);
  });
});

describe("Real-Time Discovery Telemetry Engine", () => {
  it("records and retrieves live log events for a research run", () => {
    const testRunId = "run_telemetry_test_123";
    clearRunTelemetry(testRunId);

    const log1 = recordRunTelemetry(testRunId, {
      stage: "INIT",
      level: "info",
      message: "Discovery Engine initialized",
    });

    const log2 = recordRunTelemetry(testRunId, {
      stage: "SEARCH",
      level: "info",
      message: "Tavily Search: Found 25 candidates",
    });

    const log3 = recordRunTelemetry(testRunId, {
      stage: "GATE",
      level: "rejection",
      companyName: "Austin Web Agency",
      domain: "austinwebagency.com",
      message: "[REJECTED: Quality Gate] Austin Web Agency — Matched negative anti-dump filter",
    });

    const log4 = recordRunTelemetry(testRunId, {
      stage: "APPROVED",
      level: "success",
      companyName: "Lone Star Vacation Rentals",
      domain: "lonestarvacations.com",
      phone: "(512) 555-0199",
      message: "[ACCEPTED: ICP Qualified] Lone Star Vacation Rentals • Score: 85/100 • 24/7 Concierge: YES",
    });

    const allLogs = getRunTelemetry(testRunId);
    expect(allLogs).toHaveLength(4);
    expect(allLogs[0].stage).toBe("INIT");
    expect(allLogs[2].level).toBe("rejection");
    expect(allLogs[3].level).toBe("success");

    // Filter since log2 by sequence or ID
    const sinceLog2 = getRunTelemetry(testRunId, log2.seq);
    expect(sinceLog2.length).toBe(2);
    expect(sinceLog2[0].companyName).toBe("Austin Web Agency");

    const sinceLog2ById = getRunTelemetry(testRunId, log2.id);
    expect(sinceLog2ById.length).toBe(2);
    expect(sinceLog2ById[1].companyName).toBe("Lone Star Vacation Rentals");

    clearRunTelemetry(testRunId);
    expect(getRunTelemetry(testRunId)).toHaveLength(0);
  });
});
