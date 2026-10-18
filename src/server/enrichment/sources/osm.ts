import { normalizeWebsite } from "../../domain/normalize";
import { OVERPASS_URL, buildDomainQuery, parseOsm, type OverpassResponse } from "../osm";
import type { EnrichmentSource, Finding } from "../types";

export const osmSource: EnrichmentSource = {
  meta: {
    id: "osm_overpass",
    name: "OpenStreetMap (Overpass)",
    description: "Community-maintained map data. Matched ONLY when the OSM object publishes the same website domain as the company.",
    provides: ["company phone", "business email", "street address / city / ZIP"],
  },
  appliesTo: (t) => !!t.domain && (!t.phone || !t.address || !t.zip || !t.hasEmail),
  async run(target, ctx) {
    const res = await ctx.fetchJson<OverpassResponse>(OVERPASS_URL, {
      method: "POST",
      body: `data=${encodeURIComponent(buildDomainQuery(target.domain!, target.state))}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const wanted = target.domain!.replace(/^www\./, "");
    const hit = parseOsm(res).find((b) => {
      const w = normalizeWebsite(b.website);
      return w.ok && w.value.domain.replace(/^www\./, "") === wanted;
    });
    if (!hit) return [];

    const sourceUrl = `https://www.openstreetmap.org/${hit.ref}`;
    const evidenceText = `OpenStreetMap object ${hit.ref} publishes website ${wanted} (matched by domain).`;
    const out: Finding[] = [];
    const field = (f: "phone" | "address" | "city" | "state" | "zip", value: string | null) => {
      if (value) out.push({ kind: "company_field", field: f, value, confidence: 0.8, sourceUrl, sourceType: "directory", evidenceText });
    };
    if (!target.phone) field("phone", hit.phone);
    if (!target.address) field("address", hit.street);
    if (!target.city) field("city", hit.city);
    if (!target.state) field("state", hit.state);
    if (!target.zip) field("zip", hit.zip);
    if (hit.email) {
      out.push({ kind: "contact", name: null, title: null, email: hit.email, phone: null, confidence: 0.8, verified: false, sourceUrl, sourceType: "directory", evidenceText });
    }
    return out;
  },
};
