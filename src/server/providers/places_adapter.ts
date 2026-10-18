import type { DiscoveredCandidate, DiscoveryAdapter, DiscoveryQuery, ProviderMetadata } from "./types";
import { normalizeUsPhone, normalizeWebsite } from "@/server/domain/normalize";

export const PLACES_PROVIDER_METADATA: ProviderMetadata = {
  id: "places",
  name: "Google Places API (New)",
  category: "places",
  description: "Optional Google Places text search adapter with field masks, strict request budgeting, and retention notices.",
  requiresApiKey: true,
  attributionNotice: "Data provided by Google Places API under Google Maps Platform Terms of Service. Places content is not permanently cached beyond permitted caching intervals.",
  retentionPolicyDays: 30, // Per Google terms: Place IDs can be stored indefinitely, but Place Details content should be refreshed after 30 days
  costPerRequestUsd: 0.032, // Places API (New) Text Search price tier
};

// Strict field mask requesting ONLY permitted public business contact fields
const STRICT_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.businessStatus",
].join(",");

export class PlacesAdapter implements DiscoveryAdapter {
  metadata = PLACES_PROVIDER_METADATA;

  isConfigured(config: Record<string, unknown>): boolean {
    const key = typeof config.apiKey === "string" ? config.apiKey : process.env.GOOGLE_PLACES_API_KEY;
    return !!key && key.trim().length > 10;
  }

  async discover(query: DiscoveryQuery, config: Record<string, unknown>): Promise<DiscoveredCandidate[]> {
    const apiKey = (typeof config.apiKey === "string" ? config.apiKey : process.env.GOOGLE_PLACES_API_KEY) || "";
    if (!apiKey) {
      throw new Error("Google Places API key is not configured. Enable provider in Sources tab and provide an API key.");
    }

    // Enforce request budget
    const maxRequests = typeof config.maxRequests === "number" ? config.maxRequests : 2;
    const candidates: DiscoveredCandidate[] = [];

    // Construct search queries based on keywords + locations
    const searchQueries: string[] = [];
    const keyword = query.keywords[0] || "HVAC contractor";

    if (query.cities.length > 0) {
      for (const city of query.cities.slice(0, maxRequests)) {
        searchQueries.push(`${keyword} in ${city}`);
      }
    } else if (query.states.length > 0) {
      for (const state of query.states.slice(0, maxRequests)) {
        searchQueries.push(`${keyword} in ${state}`);
      }
    } else {
      searchQueries.push(`${keyword} USA`);
    }

    for (const textQuery of searchQueries.slice(0, maxRequests)) {
      if (candidates.length >= query.limit) break;

      try {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": STRICT_FIELD_MASK,
          },
          body: JSON.stringify({
            textQuery,
            pageSize: Math.min(query.limit, 20),
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Google Places API returned ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const rawPlaces = data.places || [];

        for (const place of rawPlaces) {
          if (candidates.length >= query.limit) break;
          if (place.businessStatus && place.businessStatus !== "OPERATIONAL") continue;

          const name = place.displayName?.text;
          if (!name) continue;

          const websiteNorm = normalizeWebsite(place.websiteUri);
          const website = websiteNorm.ok ? websiteNorm.value.url : null;
          const phoneNorm = normalizeUsPhone(place.nationalPhoneNumber);
          const phone = phoneNorm ? phoneNorm.display : null;

          candidates.push({
            name,
            website,
            phone,
            provider: "places",
            providerRef: place.id,
            sourceUrl: website || `https://maps.google.com/?cid=${place.id}`,
            rawPayload: {
              placeId: place.id,
              formattedAddress: place.formattedAddress,
              attribution: PLACES_PROVIDER_METADATA.attributionNotice,
            },
          });
        }
      } catch (err: any) {
        throw new Error(`Places search error for "${textQuery}": ${err.message || String(err)}`);
      }
    }

    return candidates;
  }
}
