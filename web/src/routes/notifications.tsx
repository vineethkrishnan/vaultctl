// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import type { TFunction } from "i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Shield,
  KeyRound,
  Database,
  User,
  CheckCheck,
  Trash2,
  ArrowUpCircle,
  X,
} from "lucide-react";
import {
  getNotifications,
  markNotificationsRead,
  clearNotifications,
  snoozeUpdate,
  type NotificationCategory,
  type NotificationItem,
} from "@/lib/system-api";
import { useUpdateNotification } from "@/hooks/use-update-notification";
import { useServerFeatures } from "@/hooks/use-server-features";
import { WhatsNewModal } from "@/components/system/WhatsNewModal";

const categoryIcon: Record<NotificationCategory, typeof Shield> = {
  security: Shield,
  vault: KeyRound,
  account: User,
  backup: Database,
};

function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// dayLabel buckets a timestamp into Today / Yesterday / weekday / date, used
// for the grouped section headers.
function dayLabel(iso: string, t: TFunction): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return t("notifications:groups.earlier");
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(time)) / 86_400_000);
  if (diff <= 0) return t("notifications:groups.today");
  if (diff === 1) return t("notifications:groups.yesterday");
  if (diff < 7) return new Date(iso).toLocaleDateString(undefined, { weekday: "long" });
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// groupByDay keeps the server's newest-first order and collapses runs of the
// same day into one section.
function groupByDay(items: NotificationItem[], t: TFunction) {
  const groups: { label: string; items: NotificationItem[] }[] = [];
  for (const n of items) {
    const label = dayLabel(n.createdAt, t);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }
  return groups;
}

export function NotificationsPage() {
  const { t } = useTranslation(["notifications", "system", "common"]);
  const queryClient = useQueryClient();
  const features = useServerFeatures();
  const { data, isLoading } = useQuery({
    queryKey: ["system", "notifications"],
    queryFn: getNotifications,
    refetchOnWindowFocus: true,
    enabled: features.notifications,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["system", "notifications"] });

  const markRead = useMutation({ mutationFn: markNotificationsRead, onSuccess: invalidate });
  const clearAll = useMutation({ mutationFn: clearNotifications, onSuccess: invalidate });

  const { status: updateStatus, show: showUpdate } = useUpdateNotification(
    features.updates,
  );
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const updateVisible = showUpdate && !!updateStatus && !updateDismissed;

  const items = data?.notifications ?? [];
  const groups = groupByDay(items, t);

  return (
    <div className="mx-auto max-w-2xl space-y-4 sm:space-y-5">
      {/* Title */}
      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6 shrink-0 text-muted-foreground" />
        <h1 className="text-xl font-bold">{t("notifications:title")}</h1>
        {data && data.unreadCount > 0 && (
          <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand">
            {data.unreadCount}
          </span>
        )}
      </div>

      {updateVisible && updateStatus && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand/30 bg-brand/10 px-4 py-3 text-sm">
          <ArrowUpCircle className="h-5 w-5 shrink-0 text-brand" />
          <span className="min-w-0">
            <Trans
              t={t}
              i18nKey="system:update.available"
              values={{ version: updateStatus.latestVersion }}
              components={{ 1: <strong /> }}
            />
            {updateStatus.severity && updateStatus.severity !== "none"
              ? t("system:update.severitySuffix", { severity: updateStatus.severity })
              : ""}
            . {t("system:update.youAreOn", { version: updateStatus.currentVersion })}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowWhatsNew(true)}
              className="rounded-md bg-brand px-3 py-1 text-xs font-medium text-[#042f2a] hover:bg-brand/90"
            >
              {t("system:update.whatsNew")}
            </button>
            <button
              onClick={() => {
                snoozeUpdate(24);
                setUpdateDismissed(true);
              }}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("system:update.remindLater")}
            </button>
            <button
              onClick={() => setUpdateDismissed(true)}
              aria-label={t("common:actions.dismiss")}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {showWhatsNew && updateStatus && (
        <WhatsNewModal
          mode="available"
          version={updateStatus.latestVersion}
          notes={updateStatus.releaseNotes}
          releaseUrl={updateStatus.releaseUrl}
          onClose={() => setShowWhatsNew(false)}
          onRemindLater={() => {
            snoozeUpdate(24);
            setUpdateDismissed(true);
            setShowWhatsNew(false);
          }}
        />
      )}

      {/* Actions: full-width split on mobile, compact + right-aligned on desktop */}
      {items.length > 0 && (
        <div className="flex gap-2 sm:justify-end">
          <button
            onClick={() => markRead.mutate()}
            disabled={markRead.isPending || data?.unreadCount === 0}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 sm:flex-none sm:py-1.5"
          >
            <CheckCheck className="h-4 w-4" /> {t("notifications:markAllRead")}
          </button>
          <button
            onClick={() => clearAll.mutate()}
            disabled={clearAll.isPending}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-3 py-2.5 text-sm text-muted-foreground hover:text-destructive disabled:opacity-50 sm:flex-none sm:py-1.5"
          >
            <Trash2 className="h-4 w-4" /> {t("notifications:clearAll")}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {t("common:loading")}
        </div>
      ) : items.length === 0 ? (
        updateVisible ? null : (
          <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">
            {t("notifications:empty")}
          </div>
        )
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.label}>
              <h2 className="px-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h2>
              <ul className="overflow-hidden rounded-lg border border-border divide-y divide-border">
                {group.items.map((n) => {
                  const Icon = categoryIcon[n.category] ?? Bell;
                  return (
                    <li
                      key={n.id}
                      className={`flex items-start gap-3 px-4 py-3.5 ${n.read ? "" : "bg-brand/5"}`}
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/60">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <span className="text-sm font-medium leading-snug">{n.title}</span>
                          {!n.read && (
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {t(`notifications:categories.${n.category}`)}
                        </span>
                      </div>
                      <time
                        className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground"
                        dateTime={n.createdAt}
                      >
                        {clockTime(n.createdAt)}
                      </time>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
