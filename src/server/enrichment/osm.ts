/**
 * OpenStreetMap via the Overpass API (free, no key). Used both to DISCOVER
 * HVAC businesses and to ENRICH a known company (phone / email / address).
 */

export interface OsmBusiness {
  /** "node/123" style reference. */
  ref: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface OsmElement {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
}
export interface OverpassResponse {
  elements?: OsmElement[];
}

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function areaClause(states: string[]): { setup: string; sets: string[] } {
  if (states.length === 0) return { setup: 'area["ISO3166-1"="US"]->.a0;', sets: ["a0"] };
  const sets = states.map((_, i) => `a${i}`);
  return { setup: states.map((s, i) => `area["ISO3166-2"="US-${esc(s.toUpperCase())}"]->.a${i};`).join(""), sets };
}

export function buildHvacDiscoveryQuery(opts: { states: string[]; cities: string[]; limit: number }): string {
  const { setup, sets } = areaClause(opts.states);
  const cityFilter = opts.cities.length > 0 ? `["addr:city"~"^(${opts.cities.map(esc).join("|")})$",i]` : "";
  const parts = sets.flatMap((a) => [`nwr(area.${a})["craft"="hvac"]${cityFilter};`, `nwr(area.${a})["shop"="hvac"]${cityFilter};`]);
  return `[out:json][timeout:60];${setup}(${parts.join("")});out tags center ${Math.max(1, Math.min(opts.limit, 500))};`;
}

/** Find the OSM object that publishes this company's website domain (strong match). */
export function buildDomainQuery(domain: string, state: string | null): string {
  const { setup, sets } = areaClause(state ? [state] : []);
  const re = esc(domain.replace(/^www\./, "").replace(/\./g, "\\."));
  return `[out:json][timeout:30];${setup}nwr(area.${sets[0]})["website"~"${re}",i];out tags center 5;`;
}

export function parseOsm(json: OverpassResponse | null | undefined): OsmBusiness[] {
  const out: OsmBusiness[] = [];
  for (const el of json?.elements ?? []) {
    const t = el.tags;
    if (!t?.name || !el.type || el.id === undefined) continue;
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ").trim();
    out.push({
      ref: `${el.type}/${el.id}`,
      name: t.name.trim(),
      phone: t.phone ?? t["contact:phone"] ?? null,
      email: (t.email ?? t["contact:email"] ?? "").trim().toLowerCase() || null,
      website: t.website ?? t["contact:website"] ?? null,
      street: street || null,
      city: t["addr:city"] ?? null,
      state: t["addr:state"] ?? null,
      zip: t["addr:postcode"] ?? null,
    });
  }
  return out;
}
