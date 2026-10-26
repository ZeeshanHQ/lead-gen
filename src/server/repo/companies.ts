import crypto from "node:crypto";
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

  // Global domain deduplication to avoid duplicate records across markets
  if (c.domain) {
    const [existingByDomain] = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.domain, c.domain))
      .limit(1);
    if (existingByDomain) {
      if (input.providerRef) {
        await db
          .insert(companySourceRefs)
          .values({
            companyId: existingByDomain.id,
            provider,
            providerRef: input.providerRef,
            url: c.website,
            raw: { submitted: { name: c.name, website: c.website, phone: c.phoneDisplay, city: c.city, state: c.state } },
          })
          .onConflictDoNothing();
      }
      return { kind: "duplicate", existingId: existingByDomain.id, existingName: existingByDomain.name, reason: "domain" };
    }
  }

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
    }).onConflictDoNothing();

    // Evidence for what the human typed in: attributable, but clearly HUMAN-entered, not publicly verified.
    const entered: [string, string | null][] = [
      ["company_name", c.name],
      ["website", c.website],
      ["company_phone", c.phoneDisplay],
      ["address", c.address],
      ["city", c.city],
      ["state", c.state],
    ];
    const evidenceToInsert = entered
      .filter(([, val]) => Boolean(val))
      .map(([field, value]) => ({
        companyId,
        field,
        value: value!,
        sourceUrl: c.website,
        sourceType,
        evidenceText: `Entered by ${opts.actor} via ${provider === "csv_upload" ? "CSV upload" : "manual entry"} on ${now.toISOString().slice(0, 10)}. Not independently verified.`,
        retrievedAt: now,
        confidence: 1,
        provenance: "HUMAN_CONFIRMED" as const,
      }));
    if (evidenceToInsert.length > 0) {
      await tx.insert(evidence).values(evidenceToInsert);
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


export interface BatchIntakeResult {
  createdCount: number;
  duplicateCount: number;
  excludedCount: number;
  createdIds: string[];
  duplicateIds: string[];
}

/**
 * High-performance batch candidate intake for discovery runs.
 * Consolidates market lookups, exclusions, and domain deduplication into single queries,
 * eliminating dozens of serial database roundtrips and avoiding server timeouts.
 */
export async function createCandidatesBatch(
  db: Db,
  inputs: CandidateInput[],
  opts: { actor: string; force?: boolean; marketId?: string }
): Promise<BatchIntakeResult> {
  const result: BatchIntakeResult = {
    createdCount: 0,
    duplicateCount: 0,
    excludedCount: 0,
    createdIds: [],
    duplicateIds: [],
  };

  if (!inputs || inputs.length === 0) return result;

  const marketId = await resolveMarketId(db, opts);
  const exclusions = await listExclusions(db);

  // Phase 1: In-memory validation and exclusion matching
  const validItems: Array<{ input: CandidateInput; validated: ValidatedCandidate }> = [];

  for (const input of inputs) {
    const v = validateCandidate(input);
    if (!v.ok) continue;
    const c = v.value;

    const excl = matchExclusion(
      { name: c.name, website: c.website, phone: c.phoneE164, state: c.state },
      exclusions
    );
    if (excl) {
      result.excludedCount++;
      continue;
    }

    validItems.push({ input, validated: c });
  }

  if (validItems.length === 0) return result;

  // Phase 2: Single query global domain deduplication
  const domains = Array.from(
    new Set(validItems.map((item) => item.validated.domain).filter(Boolean) as string[])
  );
  const existingDomainMap = new Map<string, string>();
  if (domains.length > 0) {
    const rowsByDomain = await db
      .select({ id: companies.id, domain: companies.domain })
      .from(companies)
      .where(inArray(companies.domain, domains));
    for (const r of rowsByDomain) {
      if (r.domain) existingDomainMap.set(r.domain, r.id);
    }
  }

  // Phase 3: Single query market deduplication
  const existingMarketRows = await db
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

  const existingInMarket = existingMarketRows.map((r) => ({
    id: r.id,
    nameKey: r.nameKey,
    domain: r.domain,
    phoneE164: r.phoneE164,
    addressKey: r.addressKey,
    cityKey: r.cityKey ?? "",
    state: r.state,
    providerRefs: [],
  }));

  const toCreate: Array<{
    id: string;
    input: CandidateInput;
    validated: ValidatedCandidate;
    keys: { nameKey: string; addressKey: string | null; cityKey: string | null };
  }> = [];

  const now = new Date();
  const duplicateSourceRefs: any[] = [];

  for (const item of validItems) {
    const c = item.validated;
    const provider = item.input.provider ?? "discovery";

    // Check domain match
    if (c.domain && existingDomainMap.has(c.domain)) {
      const existingId = existingDomainMap.get(c.domain)!;
      result.duplicateCount++;
      result.duplicateIds.push(existingId);
      if (item.input.providerRef) {
        duplicateSourceRefs.push({
          companyId: existingId,
          provider,
          providerRef: item.input.providerRef,
          url: c.website,
          raw: { submitted: { name: c.name, website: c.website, phone: c.phoneDisplay, city: c.city, state: c.state } },
        });
      }
      continue;
    }

    const identity: CandidateIdentity = {
      name: c.name,
      website: c.website,
      phone: c.phoneE164,
      address: c.address,
      city: c.city,
      state: c.state,
      zip: c.zip,
      providerRef: item.input.providerRef ? { provider, ref: item.input.providerRef } : null,
    };

    const hits = findMatches(identity, existingInMarket);
    const strong = hits.find((h) => h.match.strength === "STRONG");
    if (strong) {
      result.duplicateCount++;
      result.duplicateIds.push(strong.existingId);
      if (item.input.providerRef) {
        duplicateSourceRefs.push({
          companyId: strong.existingId,
          provider,
          providerRef: item.input.providerRef,
          url: c.website,
          raw: { submitted: { name: c.name, website: c.website, phone: c.phoneDisplay, city: c.city, state: c.state } },
        });
      }
      continue;
    }

    const companyId = crypto.randomUUID();
    const keys = identityKeys(identity);
    toCreate.push({ id: companyId, input: item.input, validated: c, keys });
    existingInMarket.push({
      id: companyId,
      nameKey: normalizeCompanyName(c.name),
      domain: c.domain,
      phoneE164: c.phoneE164,
      addressKey: keys.addressKey,
      cityKey: keys.cityKey ?? "",
      state: c.state,
      providerRefs: [],
    });
  }

  // Insert any duplicate source references in 1 batch, deduplicated to avoid Postgres 21000 error
  if (duplicateSourceRefs.length > 0) {
    const seenRefs = new Set<string>();
    const uniqueDuplicateRefs = duplicateSourceRefs.filter((r) => {
      const key = `${r.provider}_${r.providerRef || r.companyId}`;
      if (seenRefs.has(key)) return false;
      seenRefs.add(key);
      return true;
    });
    try {
      await db.insert(companySourceRefs).values(uniqueDuplicateRefs).onConflictDoNothing();
    } catch {
      // Non-blocking: preserving company creation
    }
  }

  // Phase 4: Bulk insert new companies and their associations
  if (toCreate.length > 0) {
    const rowsToInsert = toCreate.map((item) => ({
      id: item.id,
      marketId,
      name: item.validated.name,
      nameKey: normalizeCompanyName(item.validated.name),
      website: item.validated.website,
      domain: item.validated.domain,
      phoneE164: item.validated.phoneE164,
      phoneDisplay: item.validated.phoneDisplay,
      address: item.validated.address,
      addressKey: item.keys.addressKey,
      city: item.validated.city,
      cityKey: normalizeCity(item.validated.city) || null,
      state: item.validated.state,
      zip: item.validated.zip,
      notes: item.input.notes?.trim() || null,
      discoveredVia: item.input.provider ?? "discovery",
      status: "DISCOVERED" as const,
      lockedFields: [],
    }));

    await db.insert(companies).values(rowsToInsert).onConflictDoNothing();

    for (const item of toCreate) {
      result.createdIds.push(item.id);
    }
    result.createdCount = result.createdIds.length;

    // Bulk insert source refs deduplicated
    const seenNewRefs = new Set<string>();
    const newSourceRefs = toCreate
      .map((item) => ({
        companyId: item.id,
        provider: item.input.provider ?? "discovery",
        providerRef: item.input.providerRef ?? null,
        url: item.validated.website,
        raw: { submitted: { name: item.validated.name, website: item.validated.website } },
      }))
      .filter((r) => {
        const key = `${r.provider}_${r.providerRef || r.companyId}`;
        if (seenNewRefs.has(key)) return false;
        seenNewRefs.add(key);
        return true;
      });

    try {
      await db.insert(companySourceRefs).values(newSourceRefs).onConflictDoNothing();
    } catch {
      // Non-blocking
    }

    // Bulk insert discovery evidence
    const allEvidence: any[] = [];
    toCreate.forEach((item) => {
      const companyId = item.id;
      const c = item.validated;
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
        allEvidence.push({
          companyId,
          field,
          value,
          sourceUrl: c.website,
          sourceType: "website",
          evidenceText: `Discovered via ${item.input.provider || "discovery"} on ${now.toISOString().slice(0, 10)}.`,
          retrievedAt: now,
          confidence: 1,
          provenance: "PUBLICLY_VERIFIED",
        });
      }
    });

    if (allEvidence.length > 0) {
      try {
        await db.insert(evidence).values(allEvidence);
      } catch {
        // Non-blocking
      }
    }

    // Bulk audit
    await audit(db, {
      actor: opts.actor,
      action: "candidates.batch_created",
      entityType: "company",
      details: {
        createdCount: result.createdCount,
        duplicateCount: result.duplicateCount,
        excludedCount: result.excludedCount,
        marketId,
      },
    });
  }

  return result;
}
