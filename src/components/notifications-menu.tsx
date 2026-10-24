"use client";

import React, { useState, useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  Users,
  PhoneCall,
  Sparkles,
  Info,
  Clock,
  X,
} from "lucide-react";
import {
  getNotificationsAction,
  markNotificationReadAction,
  markAllNotificationsReadAction,
  clearAllNotificationsAction,
} from "@/app/actions/notifications";
import type { AppNotification } from "@/server/repo/notifications";

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 45) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(isoString).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "Recent";
  }
}

export function NotificationsMenu() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = () => {
    startTransition(async () => {
      const res = await getNotificationsAction();
      if (res.ok) {
        setNotifications(res.notifications);
        setUnreadCount(res.unreadCount);
      }
    });
  };

  useEffect(() => {
    fetchNotifications();

    const onFocus = () => fetchNotifications();
    const interval = setInterval(fetchNotifications, 20_000);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleNotificationClick = async (notif: AppNotification) => {
    if (!notif.read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      await markNotificationReadAction(notif.id);
    }
    setIsOpen(false);
    if (notif.link) {
      router.push(notif.link);
    }
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await markAllNotificationsReadAction();
  };

  const handleClearAll = async () => {
    setNotifications([]);
    setUnreadCount(0);
    await clearAllNotificationsAction();
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-[#141418] text-zinc-300 hover:border-zinc-700 hover:bg-[#1a1a20] hover:text-white transition"
        title="Notifications"
        aria-label="View notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-[#09090b]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl border border-zinc-800 bg-[#121215] p-3 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5 px-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">Notifications</span>
              {unreadCount > 0 ? (
                <span className="rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-bold">
                  {unreadCount} new
                </span>
              ) : (
                <span className="text-[10px] text-zinc-400">Caught up</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark read</span>
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="rounded-md p-1 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 transition"
                  title="Clear all notifications"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto divide-y divide-zinc-800/50 py-1">
            {notifications.length === 0 ? (
              <div className="py-8 text-center">
                <Bell className="w-7 h-7 mx-auto text-zinc-600 mb-2 stroke-[1.5]" />
                <p className="text-xs font-semibold text-zinc-300">No Notifications</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  When leads are assigned or updated, alerts appear here.
                </p>
              </div>
            ) : (
              notifications.map((n) => {
                const isUnread = !n.read;
                return (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`group flex items-start gap-3 p-2.5 rounded-xl transition cursor-pointer ${
                      isUnread
                        ? "bg-zinc-900/80 hover:bg-zinc-800/80 border border-indigo-500/20"
                        : "hover:bg-zinc-800/50"
                    }`}
                  >
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border mt-0.5 ${
                        n.category === "lead_assigned"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : n.category === "lead_unassigned"
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          : n.category === "niche_updated"
                          ? "bg-sky-500/10 text-sky-400 border-sky-500/30"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                      }`}
                    >
                      {n.category === "lead_assigned" ? (
                        <PhoneCall className="w-3.5 h-3.5" />
                      ) : n.category === "lead_unassigned" ? (
                        <Users className="w-3.5 h-3.5" />
                      ) : n.category === "niche_updated" ? (
                        <Sparkles className="w-3.5 h-3.5" />
                      ) : (
                        <Info className="w-3.5 h-3.5" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`text-xs font-semibold truncate ${
                            isUnread ? "text-white" : "text-zinc-300"
                          }`}
                        >
                          {n.title}
                        </span>
                        <span className="text-[10px] text-zinc-500 shrink-0">
                          {formatRelativeTime(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5 leading-relaxed">
                        {n.message}
                      </p>
                    </div>

                    {isUnread && (
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0 mt-2" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
