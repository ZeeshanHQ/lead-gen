import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { exclusions } from "../db/schema";
import {
  type ExclusionKind,
  type ExclusionRule,
  EXCLUSION_KINDS,
  normalizeExclusionValue,
} from "../domain/rules";
import { audit } from "./audit";

export class ExclusionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExclusionError";
  }
}

export async function listExclusions(db: Db): Promise<ExclusionRule[]> {
  const rows = await db.select().from(exclusions).where(eq(exclusions.status, "ACTIVE")).orderBy(asc(exclusions.kind), asc(exclusions.value));
  return rows.map((r) => ({ id: r.id, kind: r.kind as ExclusionKind, value: r.value, reason: r.reason }));
}

export async function addExclusion(
  db: Db,
  input: { kind: string; value: string; reason?: string | null },
  actor: string,
): Promise<ExclusionRule> {
  if (!(EXCLUSION_KINDS as readonly string[]).includes(input.kind)) throw new ExclusionError("Unknown exclusion type");
  const kind = input.kind as ExclusionKind;
  const value = normalizeExclusionValue(kind, input.value);
  if (!value) throw new ExclusionError(`"${input.value}" is not a valid ${kind} value`);
  const [existing] = await db
    .select()
    .from(exclusions)
    .where(and(eq(exclusions.kind, kind), eq(exclusions.value, value)))
    .limit(1);
  if (existing) {
    if (existing.status === "ACTIVE") throw new ExclusionError("That exclusion already exists");
    await db.update(exclusions).set({ status: "ACTIVE", reason: input.reason ?? existing.reason, updatedAt: new Date() }).where(eq(exclusions.id, existing.id));
    await audit(db, { actor, action: "exclusion.restored", entityType: "exclusion", entityId: existing.id, newValue: { kind, value } });
    return { id: existing.id, kind, value, reason: input.reason ?? existing.reason };
  }
  const [row] = await db.insert(exclusions).values({ kind, value, reason: input.reason?.trim() || null }).returning();
  await audit(db, { actor, action: "exclusion.added", entityType: "exclusion", entityId: row!.id, newValue: { kind, value, reason: row!.reason } });
  return { id: row!.id, kind, value, reason: row!.reason };
}

export async function removeExclusion(db: Db, id: string, actor: string): Promise<void> {
  const [row] = await db.select().from(exclusions).where(eq(exclusions.id, id)).limit(1);
  if (!row) return;
  await db.update(exclusions).set({ status: "REMOVED", updatedAt: new Date() }).where(eq(exclusions.id, id));
  await audit(db, { actor, action: "exclusion.removed", entityType: "exclusion", entityId: id, oldValue: { kind: row.kind, value: row.value } });
}
