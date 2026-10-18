import type { DiscoveredCandidate, DiscoveryAdapter, DiscoveryQuery, ProviderMetadata } from "./types";
import { normalizeWebsite } from "@/server/domain/normalize";

export const URL_LIST_METADATA: ProviderMetadata = {
  id: "url_list",
  name: "Custom Website List",
  category: "user_upload",
  description: "User-provided list of company website URLs or domain names.",
  requiresApiKey: false,
  costPerRequestUsd: 0,
};

export class UrlListAdapter implements DiscoveryAdapter {
  metadata = URL_LIST_METADATA;

  isConfigured(_config: Record<string, unknown>): boolean {
    return true;
  }

  async discover(query: DiscoveryQuery, config: Record<string, unknown>): Promise<DiscoveredCandidate[]> {
    const rawUrls = typeof config.urlList === "string" ? config.urlList : "";
    if (!rawUrls) return [];

    const tokens = rawUrls
      .split(/[\r\n,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const candidates: DiscoveredCandidate[] = [];
    const seenDomains = new Set<string>();

    for (let i = 0; i < tokens.length && candidates.length < query.limit; i++) {
      const token = tokens[i];
      const norm = normalizeWebsite(token);
      if (!norm.ok) continue;

      const domain = norm.value.domain;
      if (seenDomains.has(domain)) continue;
      seenDomains.add(domain);

      // Derive human-readable name from domain (e.g. "air-pros-dallas.com" -> "Air Pros Dallas")
      const base = domain.replace(/\.(com|net|org|biz|co|us)$/i, "");
      const derivedName = base
        .split(/[-_.]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");

      candidates.push({
        name: derivedName,
        website: norm.value.url,
        provider: "url_list",
        providerRef: domain,
        sourceUrl: norm.value.url,
      });
    }

    return candidates;
  }
}
