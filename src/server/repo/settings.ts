import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { DEFAULT_SETTINGS } from "../db/bootstrap";
import { systemSettings } from "../db/schema";
import { audit } from "./audit";

export async function getSetting<T = unknown>(db: Db, key: string): Promise<T> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return (row ? row.value : DEFAULT_SETTINGS[key]) as T;
}

export async function getAllSettings(db: Db): Promise<Record<string, unknown>> {
  const rows = await db.select().from(systemSettings);
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSetting(db: Db, key: string, value: unknown, actor: string): Promise<void> {
  if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting: ${key}`);
  const old = await getSetting(db, key);
  await db
    .insert(systemSettings)
    .values({ key, value: value as never })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: value as never, updatedAt: new Date() } });
  await audit(db, { actor, action: "settings.changed", entityType: "setting", entityId: key, oldValue: old, newValue: value });
}

export async function getStaleDays(db: Db): Promise<number> {
  const v = await getSetting<number>(db, "stale_days");
  return typeof v === "number" && v > 0 ? v : 30;
}

export async function getActor(db: Db): Promise<string> {
  const { getSessionMemberId } = await import("../auth");
  const { listTeamMembers } = await import("./team");
  const id = await getSessionMemberId();
  if (id) {
    const m = (await listTeamMembers(db)).find((x) => x.id === id);
    if (m) return m.name;
  }
  const v = await getSetting<string>(db, "actor_name");
  return typeof v === "string" && v.trim() ? v : "system";
}
