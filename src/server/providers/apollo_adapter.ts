import type { DiscoveredCandidate, DiscoveryAdapter, DiscoveryQuery, ProviderMetadata } from "./types";
import { normalizeUsPhone, normalizeWebsite } from "@/server/domain/normalize";

export const APOLLO_PROVIDER_METADATA: ProviderMetadata = {
  id: "apollo",
  name: "Apollo B2B Search (Optional Adapter)",
  category: "enrichment",
  description: "Commercial B2B company and organization search API.",
  requiresApiKey: true,
  costPerRequestUsd: 0.05,
};

export class ApolloAdapter implements DiscoveryAdapter {
  metadata = APOLLO_PROVIDER_METADATA;

  isConfigured(config: Record<string, unknown>): boolean {
    const key = typeof config.apiKey === "string" ? config.apiKey : process.env.APOLLO_API_KEY;
    return !!key && key.trim().length > 5;
  }

  async discover(query: DiscoveryQuery, config: Record<string, unknown>): Promise<DiscoveredCandidate[]> {
    const apiKey = (typeof config.apiKey === "string" ? config.apiKey : process.env.APOLLO_API_KEY) || "";
    if (!apiKey) {
      throw new Error("Apollo API key is not configured.");
    }

    const res = await fetch("https://api.apollo.io/v1/organizations/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        q_organization_keyword_tags: query.keywords.slice(0, 3),
        page: 1,
        per_page: Math.min(query.limit, 25),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Apollo API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const orgs = data.organizations || [];
    const candidates: DiscoveredCandidate[] = [];

    for (const org of orgs) {
      if (candidates.length >= query.limit) break;
      const name = org.name;
      if (!name) continue;

      const websiteNorm = normalizeWebsite(org.website_url || org.primary_domain);
      const phoneNorm = normalizeUsPhone(org.phone);

      candidates.push({
        name,
        website: websiteNorm.ok ? websiteNorm.value.url : null,
        phone: phoneNorm ? phoneNorm.display : null,
        city: org.city,
        state: org.state,
        zip: org.postal_code,
        provider: "apollo",
        providerRef: org.id,
        sourceUrl: websiteNorm.ok ? websiteNorm.value.url : `https://apollo.io/companies/${org.id}`,
        rawPayload: { orgId: org.id, industry: org.industry },
      });
    }

    return candidates;
  }
}
