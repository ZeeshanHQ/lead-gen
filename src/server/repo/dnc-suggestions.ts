import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, dncSuggestions, exclusions } from "../db/schema";
import { type ExclusionKind, type ExclusionRule, normalizeExclusionValue } from "../domain/rules";
import { normalizeUsPhone, normalizeWebsite } from "../domain/normalize";
import { audit } from "./audit";
import { addExclusion } from "./exclusions";
import { createNotification } from "./notifications";

export interface CreateDncSuggestionInput {
  companyId: string;
  companyName: string;
  phone?: string | null;
  domain?: string | null;
  callerNotes?: string | null;
  detectedKeyword?: string | null;
  suggestedBy: string;
  suggestedKind?: ExclusionKind;
  suggestedValue?: string;
}

export interface DncSuggestionRecord {
  id: string;
  companyId: string;
  companyName: string;
  phone: string | null;
  domain: string | null;
  callerNotes: string | null;
  detectedKeyword: string | null;
  suggestedKind: ExclusionKind;
  suggestedValue: string;
  suggestedBy: string;
  status: "PENDING" | "ACCEPTED" | "DISMISSED";
  reviewedBy: string | null;
  reviewedAt: string | null;
  exclusionId: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapRow(r: typeof dncSuggestions.$inferSelect): DncSuggestionRecord {
  return {
    id: r.id,
    companyId: r.companyId,
    companyName: r.companyName,
    phone: r.phone ?? null,
    domain: r.domain ?? null,
    callerNotes: r.callerNotes ?? null,
    detectedKeyword: r.detectedKeyword ?? null,
    suggestedKind: r.suggestedKind as ExclusionKind,
    suggestedValue: r.suggestedValue,
    suggestedBy: r.suggestedBy,
    status: r.status as "PENDING" | "ACCEPTED" | "DISMISSED",
    reviewedBy: r.reviewedBy ?? null,
    reviewedAt: r.reviewedAt ? new Date(r.reviewedAt).toISOString() : null,
    exclusionId: r.exclusionId ?? null,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  };
}

/**
 * Phase 5 — Create a pending DNC exclusion suggestion
 * Automatically determines best exclusion kind (phone > domain > name),
 * deduplicates against active exclusions and existing pending suggestions,
 * and notifies the workspace Owner/Admin.
 */
export async function createDncSuggestion(
  db: Db,
  input: CreateDncSuggestionInput
): Promise<DncSuggestionRecord | null> {
  let kind: ExclusionKind = input.suggestedKind || "phone";
  let rawValue = input.suggestedValue || "";

  if (!rawValue) {
    if (input.phone && input.phone.trim()) {
      kind = "phone";
      const normalized = normalizeUsPhone(input.phone);
      rawValue = normalized?.e164 || input.phone.trim();
    } else if (input.domain && input.domain.trim()) {
      kind = "domain";
      const webNorm = normalizeWebsite(input.domain);
      rawValue = webNorm.ok ? webNorm.value.domain : input.domain.trim();
    } else {
      kind = "name";
      rawValue = input.companyName.trim();
    }
  }

  let normalizedValue: string | null = null;
  try {
    normalizedValue = normalizeExclusionValue(kind, rawValue);
  } catch {
    normalizedValue = rawValue.trim().toLowerCase();
  }

  if (!normalizedValue) return null;

  // 1. Check if an active exclusion already covers this value
  const [existingExclusion] = await db
    .select()
    .from(exclusions)
    .where(
      and(
        eq(exclusions.kind, kind),
        eq(exclusions.value, normalizedValue),
        eq(exclusions.status, "ACTIVE")
      )
    )
    .limit(1);

  if (existingExclusion) {
    // Already excluded
    return null;
  }

  // 2. Check if a pending suggestion already exists for this company
  const [existingPending] = await db
    .select()
    .from(dncSuggestions)
    .where(
      and(
        eq(dncSuggestions.companyId, input.companyId),
        eq(dncSuggestions.status, "PENDING")
      )
    )
    .limit(1);

  if (existingPending) {
    // Update existing pending suggestion with fresh notes
    const [updated] = await db
      .update(dncSuggestions)
      .set({
        callerNotes: input.callerNotes || existingPending.callerNotes,
        detectedKeyword: input.detectedKeyword || existingPending.detectedKeyword,
        updatedAt: new Date(),
      })
      .where(eq(dncSuggestions.id, existingPending.id))
      .returning();
    return updated ? mapRow(updated) : mapRow(existingPending);
  }

  // 3. Insert new DNC suggestion
  const [created] = await db
    .insert(dncSuggestions)
    .values({
      companyId: input.companyId,
      companyName: input.companyName,
      phone: input.phone || null,
      domain: input.domain || null,
      callerNotes: input.callerNotes || null,
      detectedKeyword: input.detectedKeyword || null,
      suggestedKind: kind,
      suggestedValue: normalizedValue,
      suggestedBy: input.suggestedBy,
      status: "PENDING",
    })
    .returning();

  if (!created) return null;

  const result = mapRow(created);

  // 4. Send high-priority notification to admin/owner
  try {
    await createNotification(db, {
      recipientMemberId: "OWNER",
      category: "dnc_suggested",
      title: "DNC Exclusion Suggested",
      message: `${input.companyName} (${normalizedValue}) requested Do Not Call: "${(input.callerNotes || "").slice(0, 90)}". Click to review blocklist.`,
      link: "/exclusions",
      entityType: "dnc_suggestion",
      entityId: created.id,
    });
  } catch {}

  // 5. Audit log
  await audit(db, {
    actor: input.suggestedBy,
    action: "dnc_suggestion.created",
    entityType: "dnc_suggestion",
    entityId: created.id,
    companyId: input.companyId,
    newValue: {
      suggestedKind: kind,
      suggestedValue: normalizedValue,
      companyName: input.companyName,
      detectedKeyword: input.detectedKeyword,
    },
  });

  return result;
}

/**
 * List all pending DNC suggestions for admin review
 */
export async function listPendingDncSuggestions(db: Db): Promise<DncSuggestionRecord[]> {
  const rows = await db
    .select()
    .from(dncSuggestions)
    .where(eq(dncSuggestions.status, "PENDING"))
    .orderBy(desc(dncSuggestions.createdAt));

  return rows.map(mapRow);
}

/**
 * Count pending DNC suggestions for dashboards & indicators
 */
export async function getPendingDncSuggestionsCount(db: Db): Promise<number> {
  const [res] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dncSuggestions)
    .where(eq(dncSuggestions.status, "PENDING"));

  return Number(res?.count || 0);
}

/**
 * Phase 5 — 1-Click Accept DNC Suggestion
 * Adds the item to the active exclusions blocklist, marks suggestion ACCEPTED,
 * updates company status, and records audit trail.
 */
export async function acceptDncSuggestion(
  db: Db,
  id: string,
  actor: string,
  overrides?: {
    kind?: ExclusionKind;
    value?: string;
    reason?: string;
  }
): Promise<{ ok: boolean; exclusion: ExclusionRule; suggestion: DncSuggestionRecord }> {
  const [row] = await db
    .select()
    .from(dncSuggestions)
    .where(eq(dncSuggestions.id, id))
    .limit(1);

  if (!row) throw new Error(`DNC suggestion ${id} not found`);
  if (row.status !== "PENDING") throw new Error(`DNC suggestion is already ${row.status}`);

  const kind = overrides?.kind || (row.suggestedKind as ExclusionKind);
  const value = overrides?.value || row.suggestedValue;
  const reason =
    overrides?.reason ||
    `DNC requested by ${row.companyName}: ${row.callerNotes || "Caller reported Do Not Call"}`;

  // 1. Add to active exclusions
  const exclusion = await addExclusion(db, { kind, value, reason }, actor);

  // 2. Mark suggestion as ACCEPTED
  const [updated] = await db
    .update(dncSuggestions)
    .set({
      status: "ACCEPTED",
      reviewedBy: actor,
      reviewedAt: new Date(),
      exclusionId: exclusion.id,
      updatedAt: new Date(),
    })
    .where(eq(dncSuggestions.id, id))
    .returning();

  // 3. Tag the company notes and ensure status is LOST
  try {
    const [comp] = await db
      .select({ notes: companies.notes, status: companies.status })
      .from(companies)
      .where(eq(companies.id, row.companyId))
      .limit(1);

    if (comp) {
      const tag = `[DNC Exclusion Confirmed: ${kind.toUpperCase()} ${value} by ${actor}]`;
      const currentNotes = comp.notes || "";
      const newNotes = currentNotes.includes(tag) ? currentNotes : `${tag}\n${currentNotes}`;
      await db
        .update(companies)
        .set({
          status: "LOST",
          notes: newNotes,
          updatedAt: new Date(),
        })
        .where(eq(companies.id, row.companyId));
    }
  } catch {}

  // 4. Audit
  await audit(db, {
    actor,
    action: "dnc_suggestion.accepted",
    entityType: "dnc_suggestion",
    entityId: id,
    companyId: row.companyId,
    newValue: { kind, value, exclusionId: exclusion.id },
  });

  return { ok: true, exclusion, suggestion: mapRow(updated!) };
}

/**
 * Phase 5 — Dismiss DNC Suggestion
 * Marks suggestion as DISMISSED without creating an exclusion.
 */
export async function dismissDncSuggestion(
  db: Db,
  id: string,
  actor: string,
  reason?: string
): Promise<{ ok: boolean; suggestion: DncSuggestionRecord }> {
  const [row] = await db
    .select()
    .from(dncSuggestions)
    .where(eq(dncSuggestions.id, id))
    .limit(1);

  if (!row) throw new Error(`DNC suggestion ${id} not found`);
  if (row.status !== "PENDING") throw new Error(`DNC suggestion is already ${row.status}`);

  const [updated] = await db
    .update(dncSuggestions)
    .set({
      status: "DISMISSED",
      reviewedBy: actor,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(dncSuggestions.id, id))
    .returning();

  await audit(db, {
    actor,
    action: "dnc_suggestion.dismissed",
    entityType: "dnc_suggestion",
    entityId: id,
    companyId: row.companyId,
    details: { reason: reason || "Dismissed by admin" },
  });

  return { ok: true, suggestion: mapRow(updated!) };
}
