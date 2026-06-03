// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Shield, KeyRound, Database, User, CheckCheck, Trash2 } from "lucide-react";
import {
  getNotifications,
  markNotificationsRead,
  clearNotifications,
  type NotificationCategory,
} from "@/lib/system-api";

const categoryIcon: Record<NotificationCategory, typeof Shield> = {
  security: Shield,
  vault: KeyRound,
  account: User,
  backup: Database,
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(then)) return "";
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["system", "notifications"],
    queryFn: getNotifications,
    refetchOnWindowFocus: true,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["system", "notifications"] });

  const markRead = useMutation({ mutationFn: markNotificationsRead, onSuccess: invalidate });
  const clearAll = useMutation({ mutationFn: clearNotifications, onSuccess: invalidate });

  const items = data?.notifications ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl font-bold">Notifications</h1>
        {data && data.unreadCount > 0 && (
          <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand">
            {data.unreadCount} unread
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => markRead.mutate()}
            disabled={markRead.isPending || items.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
          <button
            onClick={() => clearAll.mutate()}
            disabled={clearAll.isPending || items.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> Clear all
          </button>
        </div>
      </div>

      <section className="rounded-lg border border-border">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            You're all caught up — no recent activity.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((n) => {
              const Icon = categoryIcon[n.category] ?? Bell;
              return (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 ${n.read ? "" : "bg-brand/5"}`}
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/60">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{n.title}</span>
                      {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
                    </div>
                    <span className="text-xs capitalize text-muted-foreground">
                      {n.category}
                    </span>
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={n.createdAt}>
                    {relativeTime(n.createdAt)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
