"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { addExclusion, removeExclusion } from "@/server/repo/exclusions";
import { getActor } from "@/server/repo/settings";
import {
  acceptDncSuggestion,
  dismissDncSuggestion,
  listPendingDncSuggestions,
  type DncSuggestionRecord,
} from "@/server/repo/dnc-suggestions";
import type { ExclusionKind } from "@/server/domain/rules";

export async function addExclusionAction(kind: string, value: string, reason?: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const item = await addExclusion(db, { kind, value, reason }, actor);
    revalidatePath("/exclusions");
    return { ok: true, item };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to add exclusion" };
  }
}

export async function removeExclusionAction(id: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    await removeExclusion(db, id, actor);
    revalidatePath("/exclusions");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to remove exclusion" };
  }
}

/**
 * Phase 5 — List pending DNC suggestions for admin review
 */
export async function listPendingDncSuggestionsAction(): Promise<{
  ok: boolean;
  suggestions?: DncSuggestionRecord[];
  error?: string;
}> {
  try {
    const db = await getDb();
    const suggestions = await listPendingDncSuggestions(db);
    return { ok: true, suggestions };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to list DNC suggestions" };
  }
}

/**
 * Phase 5 — 1-Click Accept DNC Suggestion
 */
export async function acceptDncSuggestionAction(
  id: string,
  overrides?: { kind?: ExclusionKind; value?: string; reason?: string }
) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const res = await acceptDncSuggestion(db, id, actor, overrides);
    revalidatePath("/exclusions");
    revalidatePath("/caller");
    revalidatePath("/admin/monitor");
    return { ok: true, exclusion: res.exclusion };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to accept DNC suggestion" };
  }
}

/**
 * Phase 5 — Dismiss DNC Suggestion
 */
export async function dismissDncSuggestionAction(id: string, reason?: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    await dismissDncSuggestion(db, id, actor, reason);
    revalidatePath("/exclusions");
    revalidatePath("/caller");
    revalidatePath("/admin/monitor");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to dismiss DNC suggestion" };
  }
}
