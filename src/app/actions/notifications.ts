"use server";

import { getDb } from "@/server/db/client";
import { getActiveTeamMember } from "@/server/repo/team";
import {
  listNotificationsForMember,
  markNotificationRead,
  markAllNotificationsRead,
  clearNotificationsForMember,
  type AppNotification,
} from "@/server/repo/notifications";

export async function getNotificationsAction(): Promise<{
  ok: boolean;
  notifications: AppNotification[];
  unreadCount: number;
}> {
  try {
    const db = await getDb();
    const { activeMember } = await getActiveTeamMember(db);
    if (!activeMember || activeMember.id === "guest") {
      return { ok: true, notifications: [], unreadCount: 0 };
    }

    const notifications = await listNotificationsForMember(
      db,
      activeMember.id,
      activeMember.role
    );
    const unreadCount = notifications.filter((n) => !n.read).length;

    return { ok: true, notifications, unreadCount };
  } catch (err: any) {
    return { ok: false, notifications: [], unreadCount: 0 };
  }
}

export async function markNotificationReadAction(notifId: string): Promise<{ ok: boolean }> {
  try {
    const db = await getDb();
    const { activeMember } = await getActiveTeamMember(db);
    if (activeMember && activeMember.id !== "guest") {
      await markNotificationRead(db, notifId, activeMember.id);
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function markAllNotificationsReadAction(): Promise<{ ok: boolean }> {
  try {
    const db = await getDb();
    const { activeMember } = await getActiveTeamMember(db);
    if (activeMember && activeMember.id !== "guest") {
      await markAllNotificationsRead(db, activeMember.id, activeMember.role);
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function clearAllNotificationsAction(): Promise<{ ok: boolean }> {
  try {
    const db = await getDb();
    const { activeMember } = await getActiveTeamMember(db);
    if (activeMember && activeMember.id !== "guest") {
      await clearNotificationsForMember(db, activeMember.id, activeMember.role);
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
