"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { saveRule, duplicateRule, reEvaluateLeadsWithRule } from "@/server/repo/rules";
import { getActor } from "@/server/repo/settings";

export async function updateRuleAction(
  id: string,
  name: string,
  config: unknown,
  reEvaluateLeads: boolean = true
) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const updated = await saveRule(db, id, { name, config }, actor);

    let reScoredResult = null;
    if (reEvaluateLeads) {
      reScoredResult = await reEvaluateLeadsWithRule(db, updated.id, actor);
    }

    revalidatePath("/rules");
    revalidatePath("/review");
    revalidatePath("/caller");
    revalidatePath("/approved");
    revalidatePath("/qualified");
    revalidatePath("/");

    return {
      ok: true as const,
      id: updated.id,
      version: updated.version,
      reScored: reScoredResult,
    };
  } catch (err: any) {
    return { ok: false as const, error: err.message || "Failed to update rule" };
  }
}

export async function reEvaluateLeadsAction(id: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const result = await reEvaluateLeadsWithRule(db, id, actor);

    revalidatePath("/rules");
    revalidatePath("/review");
    revalidatePath("/caller");
    revalidatePath("/approved");
    revalidatePath("/qualified");
    revalidatePath("/");

    return { ok: true as const, ...result };
  } catch (err: any) {
    return { ok: false as const, error: err.message || "Failed to re-evaluate leads" };
  }
}

export async function duplicateRuleAction(id: string, newName: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const created = await duplicateRule(db, id, newName, actor);
    revalidatePath("/rules");
    return { ok: true, id: created.id };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to duplicate rule" };
  }
}
