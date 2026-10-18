import type { DiscoveredCandidate, DiscoveryAdapter, DiscoveryQuery, ProviderMetadata } from "./types";
import { normalizeCompanyName, normalizeWebsite, normalizeUsPhone, normalizeUsState } from "@/server/domain/normalize";

export const CSV_PROVIDER_METADATA: ProviderMetadata = {
  id: "csv_upload",
  name: "CSV / Excel Intake",
  category: "user_upload",
  description: "User-uploaded spreadsheet with candidate business names, websites, and phones.",
  requiresApiKey: false,
  costPerRequestUsd: 0,
};

export function parseCsvRows(csvText: string): Record<string, string>[] {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  // Parse header
  const firstLine = lines[0] ?? "";
  const headers = parseCsvLine(firstLine).map((h) => h.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_"));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const vals = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (h) row[h] = vals[j] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function mapRowToCandidate(row: Record<string, string>, index: number): DiscoveredCandidate | null {
  const nameKeys = ["company_name", "business_name", "company", "name", "business"];
  const siteKeys = ["website", "domain", "url", "web", "site"];
  const phoneKeys = ["phone", "telephone", "phone_number", "main_phone"];
  const streetKeys = ["address", "street", "street_address", "address_1"];
  const cityKeys = ["city", "locality"];
  const stateKeys = ["state", "province", "region"];
  const zipKeys = ["zip", "postal_code", "zip_code", "zipcode"];

  const findVal = (keys: string[]) => {
    for (const k of keys) {
      if (row[k]) return row[k].trim();
    }
    return null;
  };

  const rawName = findVal(nameKeys);
  const rawSite = findVal(siteKeys);
  const rawPhone = findVal(phoneKeys);

  if (!rawName && !rawSite) return null;

  const siteNorm = normalizeWebsite(rawSite);
  const website = siteNorm.ok ? siteNorm.value.url : rawSite;
  const name = rawName || (siteNorm.ok ? siteNorm.value.domain.split(".")[0] || "Unknown Contractor" : "Unknown Contractor");

  return {
    name,
    website,
    phone: rawPhone,
    street: findVal(streetKeys),
    city: findVal(cityKeys),
    state: findVal(stateKeys),
    zip: findVal(zipKeys),
    provider: "csv_upload",
    providerRef: `row_${index + 1}`,
    rawPayload: row,
  };
}

export class CsvAdapter implements DiscoveryAdapter {
  metadata = CSV_PROVIDER_METADATA;

  isConfigured(_config: Record<string, unknown>): boolean {
    return true;
  }

  async discover(query: DiscoveryQuery, config: Record<string, unknown>): Promise<DiscoveredCandidate[]> {
    const rawCsv = typeof config.csvContent === "string" ? config.csvContent : "";
    if (!rawCsv) return [];

    const rows = parseCsvRows(rawCsv);
    const candidates: DiscoveredCandidate[] = [];

    for (let i = 0; i < rows.length && candidates.length < query.limit; i++) {
      const row = rows[i];
      if (!row) continue;
      const c = mapRowToCandidate(row, i);
      if (c) candidates.push(c);
    }

    return candidates;
  }
}
