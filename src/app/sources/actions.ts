"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { sources } from "@/server/db/schema";
import { audit } from "@/server/repo/audit";
import { getSetting } from "@/server/repo/settings";

export async function toggleSourceAction(sourceKey: string, enabled: boolean) {
  const db = await getDb();
  const actor = ((await getSetting(db, "actor_name")) as string) || "local-user";

  await db
    .update(sources)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(sources.key, sourceKey));

  await audit(db, {
    actor,
    action: enabled ? "source.enabled" : "source.disabled",
    entityType: "source",
    entityId: sourceKey,
    details: { sourceKey, enabled },
  });

  revalidatePath("/sources");
  return { ok: true };
}

export async function configureSourceAction(sourceKey: string, formData: FormData) {
  const db = await getDb();
  const actor = ((await getSetting(db, "actor_name")) as string) || "local-user";

  const apiKey = (formData.get("apiKey") as string)?.trim() || "";
  const maxRequests = Number(formData.get("maxRequests")) || 25;

  const [existing] = await db
    .select()
    .from(sources)
    .where(eq(sources.key, sourceKey))
    .limit(1);

  const prevConfig = (existing?.config as Record<string, unknown>) || {};
  const newConfig = {
    ...prevConfig,
    apiKey: apiKey || prevConfig.apiKey,
    maxRequests,
  };

  await db
    .update(sources)
    .set({
      config: newConfig,
      enabled: apiKey ? true : existing?.enabled,
      updatedAt: new Date(),
    })
    .where(eq(sources.key, sourceKey));

  await audit(db, {
    actor,
    action: "source.configured",
    entityType: "source",
    entityId: sourceKey,
    details: { sourceKey, hasApiKey: !!apiKey },
  });

  revalidatePath("/sources");
  return { ok: true };
}
