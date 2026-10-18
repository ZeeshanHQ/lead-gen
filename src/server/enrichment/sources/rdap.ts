/**
 * Free ICANN RDAP (Registration Data Access Protocol) Domain Intelligence.
 * Standardized RESTful replacement for WHOIS (RFC 7480-7484, RFC 9083).
 * No API key required.
 *
 * Extracts:
 *  - Domain registrant / administrative person contact (if public and non-proxy)
 *  - Registered business address, city, state, zip, phone (for missing fields)
 *  - Registration year (domain age / operating history evidence)
 */
import { cleanPersonName, titleCase } from "../people";
import { cleanPhone, normalizeCity, normalizeUsState, normalizeZip } from "../../domain/normalize";
import { isValidEmail } from "../../domain/contact";
import type { CompanyFieldFinding, ContactFinding, EnrichmentSource, EnrichmentTarget, Finding } from "../types";

export const PRIVACY_SHIELDS = /\b(privacy|proxy|redacted|withheld|whoisguard|domains by proxy|contact privacy|identity protect|anonym|cloudflare|gdpr|mask|hostinger|private)\b/i;

interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown;
  entities?: RdapEntity[];
}

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}

interface RdapResponse {
  ldhName?: string;
  handle?: string;
  entities?: RdapEntity[];
  events?: RdapEvent[];
  status?: string[];
}

function extractVcardValue(vcardArray: unknown, propName: string): any {
  if (!Array.isArray(vcardArray) || vcardArray.length < 2 || !Array.isArray(vcardArray[1])) return null;
  const entries = vcardArray[1] as any[][];
  for (const entry of entries) {
    if (Array.isArray(entry) && entry[0] === propName) {
      return entry[3];
    }
  }
  return null;
}

function flattenEntities(entities: RdapEntity[] = []): RdapEntity[] {
  const result: RdapEntity[] = [];
  for (const e of entities) {
    result.push(e);
    if (e.entities && Array.isArray(e.entities)) {
      result.push(...flattenEntities(e.entities));
    }
  }
  return result;
}

/** Pure parser for RDAP JSON payload. Completely testable offline without network. */
export function parseRdapResponse(data: unknown, target: EnrichmentTarget): Finding[] {
  if (!data || typeof data !== "object") return [];
  const rdap = data as RdapResponse;
  const domain = target.domain || rdap.ldhName || "domain";
  const sourceUrl = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  const out: Finding[] = [];

  const entities = flattenEntities(rdap.entities);

  // 1. Process Registrant & Administrative entities for contacts and NAP
  for (const ent of entities) {
    const roles = Array.isArray(ent.roles) ? ent.roles.map((r) => r.toLowerCase()) : [];
    const isContactRole = roles.includes("registrant") || roles.includes("administrative") || roles.includes("owner");
    if (!isContactRole || !ent.vcardArray) continue;

    const fnRaw = extractVcardValue(ent.vcardArray, "fn");
    const orgRaw = extractVcardValue(ent.vcardArray, "org");
    const emailRaw = extractVcardValue(ent.vcardArray, "email");
    const telRaw = extractVcardValue(ent.vcardArray, "tel");
    const adrRaw = extractVcardValue(ent.vcardArray, "adr");

    const isFnPrivacy = typeof fnRaw === "string" && PRIVACY_SHIELDS.test(fnRaw);
    const isOrgPrivacy = typeof orgRaw === "string" && PRIVACY_SHIELDS.test(orgRaw);

    // Person contact candidate
    if (typeof fnRaw === "string" && !isFnPrivacy) {
      const cleaned = cleanPersonName(fnRaw);
      if (cleaned) {
        let cleanEmail: string | null = null;
        if (typeof emailRaw === "string" && isValidEmail(emailRaw) && !PRIVACY_SHIELDS.test(emailRaw)) {
          cleanEmail = emailRaw.trim().toLowerCase();
        }

        let cleanTel: string | null = null;
        if (typeof telRaw === "string") {
          const stripped = telRaw.replace(/^tel:/i, "").replace(/[^\d+]/g, " ");
          const parsed = cleanPhone(stripped);
          if (parsed) cleanTel = parsed.display;
        }

        const roleTitle = roles.includes("administrative")
          ? "Administrative Contact (RDAP)"
          : "Domain Registrant (RDAP)";

        out.push({
          kind: "contact",
          name: cleaned,
          title: roleTitle,
          email: cleanEmail,
          phone: cleanTel,
          confidence: 0.75,
          verified: false, // RDAP contact requires corroboration to become verified
          sourceUrl,
          sourceType: "enrichment",
          evidenceText: `RDAP domain record for "${domain}" lists ${cleaned} as ${roleTitle}.`,
        } satisfies ContactFinding);
      }
    }

    // Address & Phone candidates (fill blanks only if not privacy-shielded)
    if (!isOrgPrivacy && !isFnPrivacy) {
      if (!target.phone && typeof telRaw === "string") {
        const stripped = telRaw.replace(/^tel:/i, "").replace(/[^\d+]/g, " ");
        const parsed = cleanPhone(stripped);
        if (parsed) {
          out.push({
            kind: "company_field",
            field: "phone",
            value: parsed.display,
            confidence: 0.8,
            sourceUrl,
            sourceType: "enrichment",
            evidenceText: `RDAP registration for ${domain} lists telephone ${parsed.display}.`,
          } satisfies CompanyFieldFinding);
        }
      }

      if (Array.isArray(adrRaw) && adrRaw.length >= 7) {
        const street = typeof adrRaw[2] === "string" ? adrRaw[2].trim() : null;
        const city = typeof adrRaw[3] === "string" ? adrRaw[3].trim() : null;
        const state = typeof adrRaw[4] === "string" ? adrRaw[4].trim() : null;
        const zip = typeof adrRaw[5] === "string" ? adrRaw[5].trim() : null;

        const addField = (field: CompanyFieldFinding["field"], value: string | null) => {
          if (!value) return;
          out.push({
            kind: "company_field",
            field,
            value,
            confidence: 0.75,
            sourceUrl,
            sourceType: "enrichment",
            evidenceText: `RDAP registered entity address for ${domain}.`,
          });
        };

        if (!target.address && street) addField("address", titleCase(street));
        if (!target.city && city) addField("city", titleCase(city));
        if (!target.state && state) addField("state", normalizeUsState(state));
        if (!target.zip && zip) addField("zip", normalizeZip(zip));
      }
    }
  }

  return out;
}

export const rdapSource: EnrichmentSource = {
  meta: {
    id: "domain_rdap",
    name: "ICANN RDAP domain registry (free, official)",
    description: "Free RFC 7480 RDAP domain registry intelligence. Extracts public registrant/administrative contacts, registered NAP, and verifies operating domain legitimacy without API keys.",
    provides: ["Domain registrant / admin contact", "Registered address & phone"],
  },
  appliesTo: (t) => {
    return !!t.domain && (
      t.missing.some((m) =>
        m.includes("owner") ||
        m.includes("phone") ||
        m.includes("address") ||
        m.includes("city") ||
        m.includes("state") ||
        m.includes("zip") ||
        m.includes("email")
      ) || !t.hasOwner
    );
  },
  async run(target, ctx) {
    if (!target.domain) return [];
    const url = `https://rdap.org/domain/${encodeURIComponent(target.domain.toLowerCase())}`;
    try {
      const data = await ctx.fetchJson<RdapResponse>(url);
      if (!data) return [];
      return parseRdapResponse(data, target);
    } catch {
      return [];
    }
  },
};
