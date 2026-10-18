/**
 * Deduplication. Pure matching logic.
 *
 * One company must never appear several times because several sources returned it.
 * We separate:
 *   STRONG match   - safe to treat as the same canonical company (auto-merge refs)
 *   POSSIBLE match - surfaced to the human; never merged silently
 */
import {
  normalizeCity,
  normalizeCompanyName,
  normalizeStreetAddress,
  normalizeUsPhone,
  normalizeWebsite,
  normalizeZip,
  normalizeUsState,
} from "./normalize";

export interface CandidateIdentity {
  name: string;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  /** provider id for source references, e.g. { provider: "places", ref: "ChIJ..." } */
  providerRef?: { provider: string; ref: string } | null;
}

export interface IdentityKeys {
  domain: string | null;
  nameKey: string;
  phoneE164: string | null;
  addressKey: string | null; // street + zip
  cityKey: string;
  state: string | null;
}

export function identityKeys(c: CandidateIdentity): IdentityKeys {
  const site = normalizeWebsite(c.website);
  const phone = normalizeUsPhone(c.phone);
  const street = normalizeStreetAddress(c.address);
  const zip = normalizeZip(c.zip);
  return {
    domain: site.ok ? site.value.domain : null,
    nameKey: normalizeCompanyName(c.name),
    phoneE164: phone?.e164 ?? null,
    addressKey: street && zip ? `${street}|${zip}` : null,
    cityKey: normalizeCity(c.city),
    state: normalizeUsState(c.state),
  };
}

export type MatchStrength = "STRONG" | "POSSIBLE";
export interface MatchReason {
  strength: MatchStrength;
  reason: string;
}

export interface ExistingIdentity extends IdentityKeys {
  id: string;
  providerRefs?: { provider: string; ref: string }[];
}

/** Token-set Jaccard similarity of two normalized names. */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = new Set(a.split(" "));
  const sb = new Set(b.split(" "));
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Compare a candidate against one existing company. Returns null if no match. */
export function matchIdentity(
  candidate: CandidateIdentity,
  existing: ExistingIdentity,
): MatchReason | null {
  const k = identityKeys(candidate);

  if (
    candidate.providerRef &&
    existing.providerRefs?.some(
      (r) => r.provider === candidate.providerRef!.provider && r.ref === candidate.providerRef!.ref,
    )
  ) {
    return { strength: "STRONG", reason: "same provider record id" };
  }
  if (k.domain && existing.domain && k.domain === existing.domain) {
    return { strength: "STRONG", reason: `same website domain (${k.domain})` };
  }
  if (k.phoneE164 && existing.phoneE164 && k.phoneE164 === existing.phoneE164) {
    return { strength: "STRONG", reason: "same phone number" };
  }
  if (k.addressKey && existing.addressKey && k.addressKey === existing.addressKey) {
    return { strength: "STRONG", reason: "same street address and ZIP" };
  }

  const sameState = !!k.state && !!existing.state && k.state === existing.state;
  if (k.nameKey && existing.nameKey && sameState) {
    const sameCity = !!k.cityKey && k.cityKey === existing.cityKey;
    if (k.nameKey === existing.nameKey) {
      return sameCity
        ? { strength: "STRONG", reason: "same normalized name, city and state" }
        : { strength: "POSSIBLE", reason: "same normalized name in the same state" };
    }
    if (sameCity && nameSimilarity(k.nameKey, existing.nameKey) >= 0.75) {
      return { strength: "POSSIBLE", reason: "very similar name in the same city" };
    }
  }
  return null;
}

export interface DedupeHit {
  existingId: string;
  match: MatchReason;
}

/** Find all matches (strongest first) among existing companies. */
export function findMatches(
  candidate: CandidateIdentity,
  existing: ExistingIdentity[],
): DedupeHit[] {
  const hits: DedupeHit[] = [];
  for (const e of existing) {
    const m = matchIdentity(candidate, e);
    if (m) hits.push({ existingId: e.id, match: m });
  }
  return hits.sort((a, b) =>
    a.match.strength === b.match.strength ? 0 : a.match.strength === "STRONG" ? -1 : 1,
  );
}
