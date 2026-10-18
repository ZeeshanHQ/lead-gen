"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { googleSheetConnections, googleSheetMappings } from "@/server/db/schema";
import { syncApprovedLeads, DEFAULT_COLUMN_MAPPINGS } from "@/server/sheets/sync";
import { audit } from "@/server/repo/audit";
import { getSetting } from "@/server/repo/settings";

export async function connectSheetAction(formData: FormData) {
  const db = await getDb();
  const actor = ((await getSetting(db, "actor_name")) as string) || "local-user";

  const accountId = (formData.get("accountId") as string)?.trim() || "outbound@astraventa.ai";
  const spreadsheetTitle =
    (formData.get("spreadsheetTitle") as string)?.trim() ||
    "Astraventa Outbound Leads — Residential HVAC";
  const worksheet = (formData.get("worksheet") as string)?.trim() || "Approved Leads";
  const spreadsheetId =
    (formData.get("spreadsheetId") as string)?.trim() ||
    "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

  // Check existing or create connection
  const [existing] = await db.select().from(googleSheetConnections).limit(1);

  let connectionId: string;
  if (existing) {
    await db
      .update(googleSheetConnections)
      .set({
        accountId,
        spreadsheetId,
        spreadsheetTitle,
        worksheet,
        status: "CONNECTED",
        syncEnabled: true,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(googleSheetConnections.id, existing.id));
    connectionId = existing.id;
  } else {
    const [conn] = await db
      .insert(googleSheetConnections)
      .values({
        accountId,
        spreadsheetId,
        spreadsheetTitle,
        worksheet,
        status: "CONNECTED",
        syncEnabled: true,
      })
      .returning({ id: googleSheetConnections.id });
    connectionId = conn!.id;
  }

  // Insert default mappings
  for (const [sysField, colName] of Object.entries(DEFAULT_COLUMN_MAPPINGS)) {
    await db
      .insert(googleSheetMappings)
      .values({
        connectionId,
        systemField: sysField,
        sheetColumn: colName,
      })
      .onConflictDoNothing();
  }

  await audit(db, {
    actor,
    action: "sheets.connected",
    entityType: "google_sheet_connection",
    entityId: connectionId,
    details: { accountId, spreadsheetTitle, worksheet },
  });

  revalidatePath("/sheets");
  return { ok: true };
}

export async function disconnectSheetAction() {
  const db = await getDb();
  const actor = ((await getSetting(db, "actor_name")) as string) || "local-user";

  await db
    .update(googleSheetConnections)
    .set({ status: "DISCONNECTED", syncEnabled: false, updatedAt: new Date() });

  await audit(db, {
    actor,
    action: "sheets.disconnected",
    entityType: "google_sheet_connection",
  });

  revalidatePath("/sheets");
  return { ok: true };
}

export async function triggerSyncAction(dryRun = false) {
  const db = await getDb();
  const actor = ((await getSetting(db, "actor_name")) as string) || "local-user";
  const { getActiveContext } = await import("@/server/repo/markets");
  const { market } = await getActiveContext(db);

  const result = await syncApprovedLeads(db, {
    actor,
    dryRun,
    marketId: market.id,
  });

  revalidatePath("/sheets");
  revalidatePath("/approved");
  revalidatePath("/review");
  revalidatePath("/");
  return { ok: true, result };
}

export async function syncApprovedLeadsAction(options?: { actor?: string; dryRun?: boolean }) {
  try {
    const db = await getDb();
    const actor = options?.actor || ((await getSetting(db, "actor_name")) as string) || "local-user";
    const { getActiveContext } = await import("@/server/repo/markets");
    const { market } = await getActiveContext(db);
    const result = await syncApprovedLeads(db, {
      actor,
      dryRun: options?.dryRun ?? false,
      marketId: market.id,
    });

    revalidatePath("/sheets");
    revalidatePath("/approved");
    revalidatePath("/caller");
    revalidatePath("/review");
    revalidatePath("/");
    return { success: true, syncedCount: result.syncedCount, result };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to sync to Google Sheet" };
  }
}
