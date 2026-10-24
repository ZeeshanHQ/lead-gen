/**
 * Company lifecycle writes: candidate intake (with exclusions + dedupe),
 * human edits, notes. Reads for lists live in queue.ts.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, companySourceRefs, evidence, markets } from "../db/schema";
import { type CandidateIdentity, type MatchReason, findMatches, identityKeys } from "../domain/dedupe";
import {
  cleanDisplayName,
  cleanPhone,
  normalizeCity,
  normalizeCompanyName,
  normalizeStreetAddress,
  normalizeUsPhone,
  normalizeUsState,
  normalizeWebsite,
  normalizeZip,
} from "../domain/normalize";
import { type ExclusionRule, matchExclusion } from "../domain/rules";
import type { SourceType } from "../domain/facts";
import { audit } from "./audit";
import { listExclusions } from "./exclusions";

export interface CandidateInput {
  name: string;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
  /** Source adapter id; manual entry is the Phase 1 source. */
  provider?: "manual_entry" | "csv_upload" | string;
  providerRef?: string | null;
}

export type FieldErrors = Partial<Record<"name" | "website" | "phone" | "state" | "zip", string>>;

export type CreateCandidateResult =
  | { kind: "created"; id: string }
  | { kind: "invalid"; errors: FieldErrors }
  | { kind: "excluded"; exclusion: ExclusionRule }
  | { kind: "duplicate"; existingId: string; existingName: string; reason: string }
  | { kind: "possible_duplicates"; hits: { id: string; name: string; city: string | null; state: string | null; reason: string }[] };

export interface ValidatedCandidate {
  name: string;
  website: string | null;
  domain: string | null;
  phoneE164: string | null;
  phoneDisplay: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/** Validates and normalizes. Never repairs a value by guessing. */
export function validateCandidate(input: CandidateInput): { ok: true; value: ValidatedCandidate } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = cleanDisplayName(input.name ?? "");
  if (name.length < 2) errors.name = "Company name is required.";

  let website: string | null = null;
  let domain: string | null = null;
  if (input.website && input.website.trim()) {
    const w = normalizeWebsite(input.website);
    if (w.ok) {
      website = w.value.url;
      domain = w.value.domain;
    } else {
      errors.website =
        w.reason === "not_a_company_site"
          ? "That is a directory or social page, not the company's own website."
          : "Not a valid website URL.";
    }
  }

  let phoneE164: string | null = null;
  let phoneDisplay: string | null = null;
  if (input.phone && input.phone.trim()) {
    const p = cleanPhone(input.phone);
    if (p) {
      phoneE164 = p.e164;
      phoneDisplay = p.extension ? `${p.display} x${p.extension}` : p.display;
    } else {
      const digits = input.phone.replace(/\D/g, "");
      if (digits.length >= 4) {
        phoneDisplay = input.phone.trim();
        phoneE164 = digits.length >= 7 ? `+${digits}` : null;
      } else {
        errors.phone = "Not a valid phone number. Enter a 10-digit number or published phone.";
      }
    }
  }

  let state: string | null = null;
  if (input.state && input.state.trim()) {
    state = normalizeUsState(input.state);
    if (!state) errors.state = "Use a US state name or 2-letter code.";
  }

  let zip: string | null = null;
  if (input.zip && input.zip.trim()) {
    zip = normalizeZip(input.zip);
    if (!zip) errors.zip = "ZIP must be 5 digits (or ZIP+4).";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      website,
      domain,
      phoneE164,
      phoneDisplay,
      address: input.address?.trim() || null,
      city: input.city?.trim() || null,
      state,
      zip,
    },
  };
}

async function resolveMarketId(db: Db, opts: { marketId?: string; marketKey?: string }): Promise<string> {
  if (opts.marketId) {
    return opts.marketId;
  }
  if (opts.marketKey) {
    const [m] = await db.select({ id: markets.id }).from(markets).where(eq(markets.key, opts.marketKey)).limit(1);
    if (m) return m.id;
  }
  const [hvac] = await db.select({ id: markets.id }).from(markets).where(eq(markets.key, "hvac")).limit(1);
  if (hvac) return hvac.id;
  const [anyMarket] = await db.select({ id: markets.id }).from(markets).limit(1);
  if (!anyMarket) throw new Error(`No market found in database`);
  return anyMarket.id;
}

export async function createCandidate(
  db: Db,
  input: CandidateInput,
  opts: { actor: string; force?: boolean; marketKey?: string; marketId?: string },
): Promise<CreateCandidateResult> {
  const v = validateCandidate(input);
  if (!v.ok) return { kind: "invalid", errors: v.errors };
  const c = v.value;

  const marketId = await resolveMarketId(db, opts);

  const exclusion = matchExclusion(
    { name: c.name, website: c.website, phone: c.phoneE164, state: c.state },
    await listExclusions(db),
  );
  if (exclusion) {
    await audit(db, {
      actor: opts.actor,
      action: "candidate.blocked_by_exclusion",
      entityType: "company",
      newValue: { name: c.name, website: c.website },
      details: { exclusion: { kind: exclusion.kind, value: exclusion.value, reason: exclusion.reason } },
    });
    return { kind: "excluded", exclusion };
  }

  const provider = input.provider ?? "manual_entry";
  const sourceType: SourceType = provider === "csv_upload" ? "csv_upload" : "manual_entry";
  const identity: CandidateIdentity = {
    name: c.name,
    website: c.website,
    phone: c.phoneE164,
    address: c.address,
    city: c.city,
    state: c.state,
    zip: c.zip,
    providerRef: input.providerRef ? { provider, ref: input.providerRef } : null,
  };

  // Load lightweight identities of existing companies in this market/niche for matching.
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      city: companies.city,
      state: companies.state,
      nameKey: companies.nameKey,
      domain: companies.domain,
      phoneE164: companies.phoneE164,
      addressKey: companies.addressKey,
      cityKey: companies.cityKey,
    })
    .from(companies)
    .where(eq(companies.marketId, marketId));
  const refs =
    input.providerRef && rows.length > 0
      ? await db
          .select({ companyId: companySourceRefs.companyId, provider: companySourceRefs.provider, ref: companySourceRefs.providerRef })
          .from(companySourceRefs)
          .where(inArray(companySourceRefs.companyId, rows.map((r) => r.id)))
      : [];
  const existing = rows.map((r) => ({
    id: r.id,
    nameKey: r.nameKey,
    domain: r.domain,
    phoneE164: r.phoneE164,
    addressKey: r.addressKey,
    cityKey: r.cityKey ?? "",
    state: r.state,
    providerRefs: refs.filter((x) => x.companyId === r.id && x.ref).map((x) => ({ provider: x.provider, ref: x.ref! })),
  }));
  const hits = findMatches(identity, existing);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const strong = hits.find((h) => h.match.strength === "STRONG");
  if (strong) {
    const ex = byId.get(strong.existingId)!;
    // Keep the extra source reference UNDER the canonical record; do not create a second company.
    await db.insert(companySourceRefs).values({
      companyId: ex.id,
      provider,
      providerRef: input.providerRef ?? null,
      url: c.website,
      raw: { submitted: { name: c.name, website: c.website, phone: c.phoneDisplay, city: c.city, state: c.state } },
    }).onConflictDoNothing();
    await audit(db, {
      actor: opts.actor,
      action: "candidate.merged_into_existing",
      entityType: "company",
      entityId: ex.id,
      companyId: ex.id,
      details: { reason: strong.match.reason, submittedName: c.name, provider },
    });
    return { kind: "duplicate", existingId: ex.id, existingName: ex.name, reason: strong.match.reason };
  }

  const possible = hits.filter((h) => h.match.strength === "POSSIBLE");
  if (possible.length > 0 && !opts.force) {
    return {
      kind: "possible_duplicates",
      hits: possible.map((h) => {
        const ex = byId.get(h.existingId)!;
        return { id: ex.id, name: ex.name, city: ex.city, state: ex.state, reason: (h.match as MatchReason).reason };
      }),
    };
  }

  const keys = identityKeys(identity);
  const now = new Date();

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(companies)
      .values({
        marketId,
        name: c.name,
        nameKey: normalizeCompanyName(c.name),
        website: c.website,
        domain: c.domain,
        phoneE164: c.phoneE164,
        phoneDisplay: c.phoneDisplay,
        address: c.address,
        addressKey: keys.addressKey,
        city: c.city,
        cityKey: normalizeCity(c.city) || null,
        state: c.state,
        zip: c.zip,
        notes: input.notes?.trim() || null,
        discoveredVia: provider,
        status: "DISCOVERED",
        lockedFields: [],
      })
      .returning({ id: companies.id });
    const companyId = row!.id;

    await tx.insert(companySourceRefs).values({
      companyId,
      provider,
      providerRef: input.providerRef ?? null,
      url: c.website,
      raw: { submitted: { name: c.name, website: c.website, phone: c.phoneDisplay, city: c.city, state: c.state } },
    });

    // Evidence for what the human typed in: attributable, but clearly HUMAN-entered, not publicly verified.
    const entered: [string, string | null][] = [
      ["company_name", c.name],
      ["website", c.website],
      ["company_phone", c.phoneDisplay],
      ["address", c.address],
      ["city", c.city],
      ["state", c.state],
    ];
    for (const [field, value] of entered) {
      if (!value) continue;
      await tx.insert(evidence).values({
        companyId,
        field,
        value,
        sourceUrl: c.website,
        sourceType,
        evidenceText: `Entered by ${opts.actor} via ${provider === "csv_upload" ? "CSV upload" : "manual entry"} on ${now.toISOString().slice(0, 10)}. Not independently verified.`,
        retrievedAt: now,
        confidence: 1,
        provenance: "HUMAN_CONFIRMED",
      });
    }

    await audit(tx, {
      actor: opts.actor,
      action: "company.discovered",
      entityType: "company",
      entityId: companyId,
      companyId,
      newValue: { name: c.name, website: c.website, city: c.city, state: c.state, provider },
      details: possible.length > 0 ? { createdDespitePossibleDuplicates: possible.map((p) => p.existingId) } : undefined,
    });
    return companyId;
  });

  return { kind: "created", id };
}

// ----------------------------------------------------------------- editing --

export interface CompanyEdit {
  name?: string;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
}

/** Human edit of identity fields. Edited fields are locked against automated overwrite. */
export async function editCompany(
  db: Db,
  id: string,
  edit: CompanyEdit,
  actor: string,
): Promise<{ ok: true } | { ok: false; errors: FieldErrors }> {
  const [current] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!current) throw new Error("Company not found");

  const merged: CandidateInput = {
    name: edit.name ?? current.name,
    website: edit.website !== undefined ? edit.website : current.website,
    phone: edit.phone !== undefined ? edit.phone : current.phoneDisplay,
    address: edit.address !== undefined ? edit.address : current.address,
    city: edit.city !== undefined ? edit.city : current.city,
    state: edit.state !== undefined ? edit.state : current.state,
    zip: edit.zip !== undefined ? edit.zip : current.zip,
  };
  const v = validateCandidate(merged);
  if (!v.ok) return { ok: false, errors: v.errors };
  const n = v.value;

  const keys = identityKeys({ name: n.name, website: n.website, phone: n.phoneE164, address: n.address, city: n.city, state: n.state, zip: n.zip });
  const patch = {
    name: n.name,
    nameKey: normalizeCompanyName(n.name),
    website: n.website,
    domain: n.domain,
    phoneE164: n.phoneE164,
    phoneDisplay: n.phoneDisplay,
    address: n.address,
    addressKey: keys.addressKey ?? (normalizeStreetAddress(n.address) && n.zip ? `${normalizeStreetAddress(n.address)}|${n.zip}` : null),
    city: n.city,
    cityKey: normalizeCity(n.city) || null,
    state: n.state,
    zip: n.zip,
    notes: edit.notes !== undefined ? edit.notes?.trim() || null : current.notes,
  };

  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const compare: [string, unknown, unknown][] = [
    ["name", current.name, patch.name],
    ["website", current.website, patch.website],
    ["phone", current.phoneDisplay, patch.phoneDisplay],
    ["address", current.address, patch.address],
    ["city", current.city, patch.city],
    ["state", current.state, patch.state],
    ["zip", current.zip, patch.zip],
    ["notes", current.notes, patch.notes],
  ];
  for (const [k, a, b] of compare) if ((a ?? null) !== (b ?? null)) changed[k] = { from: a ?? null, to: b ?? null };
  if (Object.keys(changed).length === 0) return { ok: true };

  await db.transaction(async (tx) => {
    const lockable = Object.keys(changed).filter((k) => k !== "notes");
    await tx
      .update(companies)
      .set({ ...patch, lockedFields: [...new Set([...current.lockedFields, ...lockable])], updatedAt: new Date() })
      .where(eq(companies.id, id));
    for (const [k, ch] of Object.entries(changed)) {
      if (k === "notes" || ch.to === null) continue;
      await tx.insert(evidence).values({
        companyId: id,
        field: k === "name" ? "company_name" : k === "phone" ? "company_phone" : k,
        value: String(ch.to),
        sourceUrl: patch.website,
        sourceType: "manual_entry",
        evidenceText: `Edited by ${actor} on ${new Date().toISOString().slice(0, 10)} (previous value: ${ch.from ?? "none"}).`,
        confidence: 1,
        provenance: "HUMAN_CONFIRMED",
      });
    }
    await audit(tx, {
      actor,
      action: "lead.edited",
      entityType: "company",
      entityId: id,
      companyId: id,
      oldValue: Object.fromEntries(Object.entries(changed).map(([k, v2]) => [k, v2.from])),
      newValue: Object.fromEntries(Object.entries(changed).map(([k, v2]) => [k, v2.to])),
    });
  });
  return { ok: true };
}
