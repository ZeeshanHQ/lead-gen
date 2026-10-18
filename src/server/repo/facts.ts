/**
 * The ONLY way facts about a company change.
 *
 * Guarantees:
 *  - No evidence text, no fact (a claim without evidence cannot be stored).
 *  - Every change writes: current value on the company, an evidence row, an audit row.
 *  - Human-confirmed values are never overwritten by automation; automation files
 *    a field_suggestion ("AI found a possible update") for the user to accept/reject.
 *  - Disagreeing automated sources produce CONFLICTING, not a silent winner.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, evidence, fieldSuggestions } from "../db/schema";
import {
  type FactEntry,
  type FactKey,
  type FactMap,
  type Provenance,
  type SourceType,
  isFactKey,
  isTriFactKey,
  parseEmployeeRange,
  parseSoftware,
  TRI_STATE,
} from "../domain/facts";
import { audit } from "./audit";

export class FactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FactError";
  }
}

export interface SetFactInput {
  companyId: string;
  field: FactKey;
  value: string;
  /** 0..1 */
  confidence: number;
  provenance: Provenance;
  sourceType: SourceType;
  sourceUrl?: string | null;
  evidenceText: string;
  actor: string;
  runId?: string | null;
  retrievedAt?: Date;
}

export type SetFactResult =
  | { outcome: "applied"; entry: FactEntry; evidenceId: string }
  | { outcome: "corroborated"; entry: FactEntry; evidenceId: string }
  | { outcome: "suggested"; suggestionId: string; evidenceId: string }
  | { outcome: "conflict"; entry: FactEntry; evidenceId: string };

export function validateFactValue(field: FactKey, value: string): string {
  const v = value.trim();
  if (isTriFactKey(field)) {
    const up = v.toUpperCase();
    if (!(TRI_STATE as readonly string[]).includes(up)) {
      throw new FactError(`${field} must be YES, NO, UNKNOWN or CONFLICTING`);
    }
    return up;
  }
  if (field === "employees") {
    const r = parseEmployeeRange(v);
    if (!r) throw new FactError('employees must look like "12", "5-50" or "50+"');
    return v.replace(/\s+/g, "");
  }
  if (field === "software") {
    const items = parseSoftware(v);
    if (items.length === 0) throw new FactError("software must list servicetitan, jobber, housecall_pro or other");
    return [...new Set(items)].sort().join(",");
  }
  if (!v) throw new FactError(`${field} cannot be empty`);
  return v;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) throw new FactError("confidence must be a number between 0 and 1");
  return Math.min(1, Math.max(0, n));
}

export async function setFact(db: Db, input: SetFactInput): Promise<SetFactResult> {
  if (!isFactKey(input.field)) throw new FactError(`Unknown fact: ${input.field}`);
  if (!input.evidenceText || !input.evidenceText.trim()) {
    throw new FactError("Evidence text is required. A claim without evidence cannot be stored.");
  }
  const value = validateFactValue(input.field, input.value);
  if (value === "UNKNOWN") throw new FactError("Use clearFact() to reset a fact to UNKNOWN.");
  const confidence = clamp01(input.confidence);
  const retrievedAt = input.retrievedAt ?? new Date();
  const isHuman = input.provenance === "HUMAN_CONFIRMED";

  return db.transaction(async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, input.companyId)).limit(1);
    if (!company) throw new FactError("Company not found");

    const facts: FactMap = { ...(company.facts ?? {}) };
    const current = facts[input.field];
    const locked =
      company.lockedFields.includes(input.field) || current?.provenance === "HUMAN_CONFIRMED";

    const insertEvidence = async (status: string) => {
      const [row] = await tx
        .insert(evidence)
        .values({
          companyId: input.companyId,
          runId: input.runId ?? null,
          field: input.field,
          value,
          sourceUrl: input.sourceUrl ?? null,
          sourceType: input.sourceType,
          evidenceText: input.evidenceText.trim(),
          retrievedAt,
          confidence,
          provenance: input.provenance,
          status,
          lastVerifiedAt: input.provenance === "PUBLICLY_VERIFIED" ? retrievedAt : null,
        })
        .returning({ id: evidence.id });
      return row!.id;
    };

    // ---- Automation vs a human-locked field: never overwrite; suggest.
    if (locked && !isHuman) {
      if (current?.value === value) {
        const evId = await insertEvidence("ACTIVE");
        return { outcome: "corroborated" as const, entry: current, evidenceId: evId };
      }
      const evId = await insertEvidence("PROPOSED");
      const [s] = await tx
        .insert(fieldSuggestions)
        .values({
          companyId: input.companyId,
          field: input.field,
          currentValue: current?.value ?? null,
          suggestedValue: value,
          suggestedConfidence: confidence,
          suggestedProvenance: input.provenance,
          evidenceId: evId,
        })
        .returning({ id: fieldSuggestions.id });
      await audit(tx, {
        actor: input.actor,
        action: "fact.suggested",
        entityType: "company",
        entityId: input.companyId,
        companyId: input.companyId,
        oldValue: { [input.field]: current?.value ?? null },
        newValue: { [input.field]: value },
        details: { reason: "field is human-confirmed", suggestionId: s!.id },
      });
      return { outcome: "suggested" as const, suggestionId: s!.id, evidenceId: evId };
    }

    // ---- Conflict between automated sources
    let nextValue = value;
    let nextConfidence = confidence;
    let outcome: "applied" | "conflict" | "corroborated" = "applied";
    if (
      !isHuman &&
      isTriFactKey(input.field) &&
      current &&
      current.provenance !== "HUMAN_CONFIRMED" &&
      (current.value === "YES" || current.value === "NO") &&
      (value === "YES" || value === "NO") &&
      current.value !== value
    ) {
      const [prior] = current.evidenceId
        ? await tx.select().from(evidence).where(eq(evidence.id, current.evidenceId)).limit(1)
        : [];
      const sameSource = prior && prior.sourceUrl && prior.sourceUrl === (input.sourceUrl ?? null);
      if (!sameSource) {
        nextValue = "CONFLICTING";
        nextConfidence = Math.min(current.confidence, confidence);
        outcome = "conflict";
      }
    } else if (current && current.value === value && !isHuman) {
      outcome = "corroborated";
      nextConfidence = Math.max(current.confidence, confidence);
    }

    // Supersede earlier ACTIVE evidence for this field unless we are keeping both sides of a conflict
    // or adding corroboration.
    if (outcome === "applied") {
      await tx
        .update(evidence)
        .set({ status: "SUPERSEDED", updatedAt: new Date() })
        .where(and(eq(evidence.companyId, input.companyId), eq(evidence.field, input.field), eq(evidence.status, "ACTIVE")));
    }
    const evId = await insertEvidence("ACTIVE");

    const entry: FactEntry = {
      value: nextValue,
      confidence: nextConfidence,
      provenance: input.provenance,
      evidenceId: evId,
      updatedAt: new Date().toISOString(),
    };
    facts[input.field] = entry;

    const lockedFields = isHuman
      ? [...new Set([...company.lockedFields, input.field])]
      : company.lockedFields;

    await tx
      .update(companies)
      .set({
        facts,
        lockedFields,
        updatedAt: new Date(),
        ...(input.provenance === "PUBLICLY_VERIFIED" ? { lastVerifiedAt: retrievedAt } : {}),
      })
      .where(eq(companies.id, input.companyId));

    if (nextValue !== current?.value || outcome === "applied") {
      await audit(tx, {
        actor: input.actor,
        action: isHuman ? "fact.edited" : "fact.updated",
        entityType: "company",
        entityId: input.companyId,
        companyId: input.companyId,
        oldValue: { [input.field]: current?.value ?? "UNKNOWN" },
        newValue: { [input.field]: nextValue },
        details: { provenance: input.provenance, sourceUrl: input.sourceUrl ?? null, evidenceId: evId },
      });
    }
    return outcome === "conflict"
      ? { outcome: "conflict" as const, entry, evidenceId: evId }
      : outcome === "corroborated"
        ? { outcome: "corroborated" as const, entry, evidenceId: evId }
        : { outcome: "applied" as const, entry, evidenceId: evId };
  });
}

/** Human resets a fact to UNKNOWN. History is preserved (evidence is marked SUPERSEDED, not deleted). */
export async function clearFact(db: Db, companyId: string, field: FactKey, actor: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) throw new FactError("Company not found");
    const facts: FactMap = { ...(company.facts ?? {}) };
    const old = facts[field];
    if (!old) return;
    delete facts[field];
    await tx
      .update(evidence)
      .set({ status: "SUPERSEDED", updatedAt: new Date() })
      .where(and(eq(evidence.companyId, companyId), eq(evidence.field, field), eq(evidence.status, "ACTIVE")));
    await tx
      .update(companies)
      .set({
        facts,
        lockedFields: company.lockedFields.filter((f) => f !== field),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));
    await audit(tx, {
      actor,
      action: "fact.cleared",
      entityType: "company",
      entityId: companyId,
      companyId,
      oldValue: { [field]: old.value },
      newValue: { [field]: "UNKNOWN" },
    });
  });
}

/** User accepts "AI found a possible update". The field stays human-locked. */
export async function acceptSuggestion(db: Db, suggestionId: string, actor: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(fieldSuggestions).where(eq(fieldSuggestions.id, suggestionId)).limit(1);
    if (!s || s.status !== "PENDING") throw new FactError("Suggestion not found or already resolved");
    const [company] = await tx.select().from(companies).where(eq(companies.id, s.companyId)).limit(1);
    if (!company) throw new FactError("Company not found");

    await tx
      .update(evidence)
      .set({ status: "SUPERSEDED", updatedAt: new Date() })
      .where(and(eq(evidence.companyId, s.companyId), eq(evidence.field, s.field), eq(evidence.status, "ACTIVE")));
    if (s.evidenceId) {
      await tx.update(evidence).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(evidence.id, s.evidenceId));
    }
    const facts: FactMap = { ...(company.facts ?? {}) };
    facts[s.field as FactKey] = {
      value: s.suggestedValue,
      confidence: s.suggestedConfidence,
      provenance: s.suggestedProvenance,
      evidenceId: s.evidenceId,
      updatedAt: new Date().toISOString(),
    };
    await tx.update(companies).set({ facts, updatedAt: new Date() }).where(eq(companies.id, s.companyId));
    await tx
      .update(fieldSuggestions)
      .set({ status: "ACCEPTED", resolvedBy: actor, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(fieldSuggestions.id, suggestionId));
    await audit(tx, {
      actor,
      action: "fact.suggestion_accepted",
      entityType: "company",
      entityId: s.companyId,
      companyId: s.companyId,
      oldValue: { [s.field]: s.currentValue },
      newValue: { [s.field]: s.suggestedValue },
    });
  });
}

export async function rejectSuggestion(db: Db, suggestionId: string, actor: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(fieldSuggestions).where(eq(fieldSuggestions.id, suggestionId)).limit(1);
    if (!s || s.status !== "PENDING") throw new FactError("Suggestion not found or already resolved");
    if (s.evidenceId) {
      await tx.update(evidence).set({ status: "REJECTED", updatedAt: new Date() }).where(eq(evidence.id, s.evidenceId));
    }
    await tx
      .update(fieldSuggestions)
      .set({ status: "REJECTED", resolvedBy: actor, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(fieldSuggestions.id, suggestionId));
    await audit(tx, {
      actor,
      action: "fact.suggestion_rejected",
      entityType: "company",
      entityId: s.companyId,
      companyId: s.companyId,
      oldValue: { [s.field]: s.currentValue },
      newValue: { [s.field]: s.suggestedValue },
    });
  });
}
