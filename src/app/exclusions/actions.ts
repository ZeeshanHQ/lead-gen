"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { addExclusion, removeExclusion } from "@/server/repo/exclusions";
import { getActor } from "@/server/repo/settings";

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
