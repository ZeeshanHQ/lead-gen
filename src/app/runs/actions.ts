"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import {
  createResearchRun,
  executeRun,
  pauseRun,
  cancelRun,
  type RunMode,
} from "@/server/research/runner";
import { getSetting } from "@/server/repo/settings";

export async function triggerRunAction(formData: FormData) {
  const db = await getDb();
  const actor = ((await getSetting(db, "actor_name")) as string) || "local-user";
  const { getActiveContext } = await import("@/server/repo/markets");
  const { market, rule } = await getActiveContext(db);

  const mode = (formData.get("mode") as RunMode) || "small";
  const maxCandidates = Number(formData.get("maxCandidates")) || undefined;
  const concurrency = Number(formData.get("concurrency")) || 2;
  const pagesPerCompany = Number(formData.get("pagesPerCompany")) || 12;
  const dryRun = formData.get("dryRun") === "true";

  const runId = await createResearchRun(db, {
    mode,
    marketId: market.id,
    ruleId: rule.id,
    actor,
    dryRun,
    maxCandidates,
    concurrency,
    pagesPerCompany,
  });

  // Execute run in background or inline
  try {
    await executeRun(db, runId);
  } catch {
    // Status is tracked on researchRuns row
  }

  revalidatePath("/runs");
  revalidatePath("/review");
  revalidatePath("/");
  return { ok: true, runId };
}

export async function pauseRunAction(runId: string) {
  const db = await getDb();
  const actor = ((await getSetting(db, "actor_name")) as string) || "local-user";
  await pauseRun(db, runId, actor);
  revalidatePath("/runs");
  return { ok: true };
}

export async function cancelRunAction(runId: string) {
  const db = await getDb();
  const actor = ((await getSetting(db, "actor_name")) as string) || "local-user";
  await cancelRun(db, runId, actor);
  revalidatePath("/runs");
  return { ok: true };
}
