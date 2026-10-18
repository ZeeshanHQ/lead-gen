"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { getActor } from "@/server/repo/settings";
import { enrichAlmostQualified, enrichCompany, type EnrichmentReport } from "@/server/enrichment/pipeline";

export type EnrichActionResult = { ok: true; reports: EnrichmentReport[] } | { ok: false; error: string };

function refresh() {
  revalidatePath("/qualified");
  revalidatePath("/review");
  revalidatePath("/approved");
  revalidatePath("/contacts");
  revalidatePath("/");
}

export async function enrichLeadAction(companyId: string): Promise<EnrichActionResult> {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const report = await enrichCompany(db, companyId, { actor });
    refresh();
    return { ok: true, reports: [report] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Enrichment failed" };
  }
}

/** Capped per click so a single request stays short; click again for the next batch. */
export async function enrichBatchAction(limit = 5): Promise<EnrichActionResult> {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const reports = await enrichAlmostQualified(db, { actor, limit: Math.min(Math.max(limit, 1), 10) });
    refresh();
    return { ok: true, reports };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Enrichment failed" };
  }
}
