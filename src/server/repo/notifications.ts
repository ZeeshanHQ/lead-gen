import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { systemSettings } from "../db/schema";

export interface AppNotification {
  id: string;
  recipientMemberId: string; // Target member ID, "ALL", or "OWNER"
  title: string;
  message: string;
  category: "lead_assigned" | "lead_unassigned" | "niche_updated" | "system" | "followup_due";
  link?: string;
  entityType?: string;
  entityId?: string;
  read: boolean;
  createdAt: string;
}

const NOTIFICATIONS_KEY = "app_notifications_registry";
const MAX_NOTIFICATIONS = 150;

async function readNotificationsRaw(db: Db): Promise<AppNotification[]> {
  try {
    const [row] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, NOTIFICATIONS_KEY))
      .limit(1);
    return Array.isArray(row?.value) ? (row.value as AppNotification[]) : [];
  } catch {
    return [];
  }
}

async function writeNotificationsRaw(db: Db, notifications: AppNotification[]): Promise<void> {
  const trimmed = notifications.slice(0, MAX_NOTIFICATIONS);
  await db
    .insert(systemSettings)
    .values({
      key: NOTIFICATIONS_KEY,
      value: trimmed as never,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: trimmed as never, updatedAt: new Date() },
    });
}

export async function listNotificationsForMember(
  db: Db,
  memberId: string,
  memberRole?: string
): Promise<AppNotification[]> {
  const all = await readNotificationsRaw(db);
  const isOwner = memberRole === "OWNER" || memberId === "member_owner";

  return all
    .filter((n) => {
      if (n.recipientMemberId === "ALL") return true;
      if (n.recipientMemberId === memberId) return true;
      if (isOwner && n.recipientMemberId === "OWNER") return true;
      return false;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function createNotification(
  db: Db,
  notif: {
    recipientMemberId: string;
    title: string;
    message: string;
    category: AppNotification["category"];
    link?: string;
    entityType?: string;
    entityId?: string;
  }
): Promise<AppNotification> {
  const all = await readNotificationsRaw(db);
  const newNotif: AppNotification = {
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    recipientMemberId: notif.recipientMemberId,
    title: notif.title,
    message: notif.message,
    category: notif.category,
    link: notif.link || "/caller",
    entityType: notif.entityType,
    entityId: notif.entityId,
    read: false,
    createdAt: new Date().toISOString(),
  };

  const updated = [newNotif, ...all];
  await writeNotificationsRaw(db, updated);
  return newNotif;
}

export async function markNotificationRead(
  db: Db,
  notifId: string,
  memberId: string
): Promise<void> {
  const all = await readNotificationsRaw(db);
  const updated = all.map((n) => (n.id === notifId ? { ...n, read: true } : n));
  await writeNotificationsRaw(db, updated);
}

export async function markAllNotificationsRead(
  db: Db,
  memberId: string,
  memberRole?: string
): Promise<void> {
  const all = await readNotificationsRaw(db);
  const isOwner = memberRole === "OWNER" || memberId === "member_owner";

  const updated = all.map((n) => {
    const isTarget =
      n.recipientMemberId === memberId ||
      n.recipientMemberId === "ALL" ||
      (isOwner && n.recipientMemberId === "OWNER");
    return isTarget ? { ...n, read: true } : n;
  });

  await writeNotificationsRaw(db, updated);
}

export async function clearNotificationsForMember(
  db: Db,
  memberId: string,
  memberRole?: string
): Promise<void> {
  const all = await readNotificationsRaw(db);
  const isOwner = memberRole === "OWNER" || memberId === "member_owner";

  const remaining = all.filter((n) => {
    const isTarget =
      n.recipientMemberId === memberId ||
      n.recipientMemberId === "ALL" ||
      (isOwner && n.recipientMemberId === "OWNER");
    return !isTarget;
  });

  await writeNotificationsRaw(db, remaining);
}
