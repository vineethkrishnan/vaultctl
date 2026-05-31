// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor, AlertTriangle, Check, History } from "lucide-react";
import {
  getUsersMeSessions,
  getGetUsersMeSessionsQueryKey,
  deleteUsersMeSessionsId,
} from "@/api/users/users";
import { useAuthStore } from "@/lib/auth-store";
import { humanizeDeviceName } from "@/lib/device";
import { relativeAge } from "@/lib/time";

interface RawSession {
  id: string;
  deviceName: string;
  ipAddress: string;
  lastActiveAt?: string;
  createdAt: string;
}

interface DeviceGroup {
  key: string;
  deviceName: string;
  ipAddress: string;
  createdAt: string;
  lastActiveAt?: string;
  ids: string[];
  isCurrent: boolean;
}

// A non-current session is "stale" once it hasn't been active for a while.
// Active web sessions refresh well within this window; abandoned ones (from
// reload/relogin cycles) age past it and move to Past sessions.
const STALE_AFTER_MS = 30 * 60 * 1000;

function lastActiveTs(g: DeviceGroup): number {
  return Date.parse(g.lastActiveAt ?? g.createdAt) || 0;
}

export function SessionsPanel() {
  const queryClient = useQueryClient();
  const currentSessionId = useAuthStore((s) => s.sessionId);

  const {
    data: res,
    isLoading,
    isError,
  } = useQuery({
    queryKey: getGetUsersMeSessionsQueryKey(),
    queryFn: () => getUsersMeSessions(),
  });

  const groups = useMemo<DeviceGroup[]>(() => {
    if (!res || res.status !== 200) return [];
    const raw = (res.data ?? []) as RawSession[];
    const byDevice = new Map<string, DeviceGroup>();
    for (const session of raw) {
      const key = session.deviceName || session.id;
      const existing = byDevice.get(key);
      if (!existing) {
        byDevice.set(key, {
          key,
          deviceName: session.deviceName,
          ipAddress: session.ipAddress,
          createdAt: session.createdAt,
          lastActiveAt: session.lastActiveAt,
          ids: [session.id],
          isCurrent: session.id === currentSessionId,
        });
        continue;
      }
      existing.ids.push(session.id);
      existing.isCurrent ||= session.id === currentSessionId;
      if (session.createdAt > existing.createdAt) {
        existing.createdAt = session.createdAt;
        existing.ipAddress = session.ipAddress;
      }
      if (
        session.lastActiveAt &&
        (!existing.lastActiveAt || session.lastActiveAt > existing.lastActiveAt)
      ) {
        existing.lastActiveAt = session.lastActiveAt;
      }
    }
    return [...byDevice.values()];
  }, [res, currentSessionId]);

  const { active, past } = useMemo(() => {
    const now = Date.now();
    const byRecent = (a: DeviceGroup, b: DeviceGroup) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return lastActiveTs(b) - lastActiveTs(a);
    };
    const activeGroups: DeviceGroup[] = [];
    const pastGroups: DeviceGroup[] = [];
    for (const g of groups) {
      if (g.isCurrent || now - lastActiveTs(g) <= STALE_AFTER_MS) {
        activeGroups.push(g);
      } else {
        pastGroups.push(g);
      }
    }
    return { active: activeGroups.sort(byRecent), past: pastGroups.sort(byRecent) };
  }, [groups]);

  const otherIds = useMemo(
    () => groups.filter((g) => !g.isCurrent).flatMap((g) => g.ids),
    [groups],
  );
  const pastIds = useMemo(() => past.flatMap((g) => g.ids), [past]);

  const revokeMutation = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => deleteUsersMeSessionsId(id))),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: getGetUsersMeSessionsQueryKey(),
      });
    },
  });

  async function handleRevoke(group: DeviceGroup) {
    if (group.isCurrent) {
      const confirmed = window.confirm(
        "Revoking this device will log you out here. Continue?",
      );
      if (!confirmed) return;
    }
    await revokeMutation.mutateAsync(group.ids);
    if (group.isCurrent) {
      useAuthStore.getState().logout();
      window.location.reload();
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="h-16 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4" />
        <span>Failed to load sessions</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Monitor className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Active sessions</h2>
        <span className="text-xs text-muted-foreground">({active.length})</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Devices currently signed in. Revoking a device ends its access
        immediately.
      </p>

      {otherIds.length > 0 && (
        <button
          type="button"
          onClick={() => revokeMutation.mutate(otherIds)}
          disabled={revokeMutation.isPending}
          className="rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50"
        >
          Sign out of all other devices
        </button>
      )}

      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((group) => (
            <SessionRow
              key={group.key}
              group={group}
              pending={revokeMutation.isPending}
              onRevoke={() => handleRevoke(group)}
            />
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">Past sessions</h2>
              <span className="text-xs text-muted-foreground">
                ({past.length})
              </span>
            </div>
            <button
              type="button"
              onClick={() => revokeMutation.mutate(pastIds)}
              disabled={revokeMutation.isPending}
              className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              Clear all
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Older sessions that have not been active recently. Revoke any you do
            not recognize.
          </p>
          <ul className="space-y-2">
            {past.map((group) => (
              <SessionRow
                key={group.key}
                group={group}
                pending={revokeMutation.isPending}
                onRevoke={() => handleRevoke(group)}
                muted
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SessionRow({
  group,
  pending,
  onRevoke,
  muted = false,
}: {
  group: DeviceGroup;
  pending: boolean;
  onRevoke: () => void;
  muted?: boolean;
}) {
  const lastIso = group.lastActiveAt ?? group.createdAt;
  return (
    <li
      className={`flex flex-col gap-3 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-start sm:justify-between ${
        muted ? "opacity-75" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-words font-medium">
            {humanizeDeviceName(group.deviceName)}
          </span>
          {group.isCurrent && (
            <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-500">
              <Check className="h-3 w-3" />
              This device
            </span>
          )}
          {group.ids.length > 1 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {group.ids.length} sessions
            </span>
          )}
        </div>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <dt>IP</dt>
          <dd className="break-all font-mono">{group.ipAddress || "—"}</dd>
          <dt>Last active</dt>
          <dd>{group.isCurrent ? "now" : relativeAge(lastIso)}</dd>
        </dl>
      </div>
      <button
        type="button"
        onClick={onRevoke}
        disabled={pending}
        className="flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50"
        title={group.isCurrent ? "Log out of this device" : "Revoke device"}
      >
        <LogOut className="h-3.5 w-3.5" />
        <span className="sm:hidden">
          {group.isCurrent ? "Log out" : "Revoke"}
        </span>
      </button>
    </li>
  );
}
