// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Activity,
  LogIn,
  LogOut,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Lock,
  Database,
  Building2,
  UserCog,
  Globe,
  Monitor,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getOwnAudit, type AuditEntry } from "@/lib/system-api";

const AUDIT_PAGE_SIZE = 50;

// Stable audit actions (internal/domain/auditlog/actions.go). Each maps to an
// i18n key under activity:actions.* and an icon. Unknown actions fall back to a
// humanised version of the raw string so a newly added server action still
// renders without a client change.
const ACTION_ICON: Record<string, LucideIcon> = {
  "login.success": LogIn,
  "login.failed": ShieldAlert,
  "login.failed.unknown_email": ShieldAlert,
  "auth.logout": LogOut,
  "auth.refreshed": RefreshCw,
  "auth.step_up": ShieldCheck,
  "auth.password_changed": KeyRound,
  "auth.recovery_reset": KeyRound,
  "auth.recovery_kit_rotated": KeyRound,
  "auth.totp_enabled": ShieldCheck,
  "auth.totp_disabled": ShieldAlert,
  "session.revoked": Lock,
  "vault.created": Database,
  "vault.rekeyed": KeyRound,
  "vault.member_added": UserCog,
  "vault.member_removed": UserCog,
  "org.created": Building2,
  "org.role_changed": UserCog,
  "org.member_removed": UserCog,
  "api_key.created": KeyRound,
  "api_key.revoked": KeyRound,
  "invite.created": UserCog,
  "invite.revoked": UserCog,
  "backup.run": Database,
  "backup.configured": Database,
  "backup.removed": Database,
  "backup.restored": Database,
};

const KNOWN_ACTIONS = new Set(Object.keys(ACTION_ICON));

function humaniseAction(action: string): string {
  const verb = action.includes(".") ? action.slice(action.indexOf(".") + 1) : action;
  return verb.replace(/[._]/g, " ").replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// parseDeviceLabel turns a user-agent string into a short "Browser on OS" label
// for display. It is intentionally coarse - exact version detection is not the
// goal, a recognisable device is.
export function parseDeviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return "";
  const ua = userAgent;

  let os = "";
  if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = "Safari";
  else if (/curl\//i.test(ua)) browser = "curl";

  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "";
}

function formatAbsolute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation("activity");
  const Icon = ACTION_ICON[entry.action] ?? Activity;
  const label = KNOWN_ACTIONS.has(entry.action)
    ? t(`actions.${entry.action}`)
    : humaniseAction(entry.action);
  const device = parseDeviceLabel(entry.userAgent);

  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/60">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium leading-snug">{label}</span>
          {entry.resourceType && (
            <span className="text-xs text-muted-foreground">
              {t(`resources.${entry.resourceType}`)}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {device && (
            <span className="inline-flex items-center gap-1">
              <Monitor className="h-3 w-3" /> {device}
            </span>
          )}
          {entry.ipAddress && (
            <span className="inline-flex items-center gap-1">
              <Globe className="h-3 w-3" /> {entry.ipAddress}
            </span>
          )}
        </div>
      </div>
      <time
        className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground"
        dateTime={entry.createdAt}
        title={formatAbsolute(entry.createdAt)}
      >
        {formatAbsolute(entry.createdAt)}
      </time>
    </li>
  );
}

export function ActivityPage() {
  const { t } = useTranslation(["activity", "common"]);

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["activity", "audit"],
    queryFn: ({ pageParam }) =>
      getOwnAudit({ limit: AUDIT_PAGE_SIZE, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextBefore || undefined,
  });

  const entries = data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-4 sm:space-y-5">
      <div className="flex items-center gap-3">
        <Activity className="h-6 w-6 shrink-0 text-muted-foreground" />
        <h1 className="text-xl font-bold">{t("activity:title")}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t("activity:description")}</p>

      {isLoading ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {t("common:loading")}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {t("activity:error")}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">
          {t("activity:empty")}
        </div>
      ) : (
        <>
          <ul className="overflow-hidden rounded-lg border border-border divide-y divide-border">
            {entries.map((entry, index) => (
              <AuditRow key={`${entry.createdAt}-${index}`} entry={entry} />
            ))}
          </ul>
          {hasNextPage && (
            <div className="flex justify-center">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="rounded-md border border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {isFetchingNextPage
                  ? t("activity:loadingMore")
                  : t("activity:loadMore")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
