import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor, AlertTriangle, Check } from "lucide-react";
import {
  getUsersMeSessions,
  getGetUsersMeSessionsQueryKey,
  deleteUsersMeSessionsId,
} from "@/api/users/users";
import { useAuthStore } from "@/lib/auth-store";

/**
 * Active sessions viewer — M7 polish.
 *
 * Lists every un-expired refresh-token session for the current user and
 * offers a one-click revoke. The current session is marked so the user
 * can't accidentally log themselves out (the UI still allows it, with a
 * confirmation, because selectively revoking "this device" is a valid
 * security action).
 *
 * Acceptance criteria come from architecture §M7 deliverables: "Settings:
 * profile, sessions, auto-lock config, clipboard clear config" and from
 * PRD §10.4: GET /users/me/sessions + DELETE /users/me/sessions/{id}.
 */
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

  const sessions = useMemo(() => {
    if (!res || res.status !== 200) return [];
    // The generated response type is loose; the actual shape is
    // SessionResponse[]. Cast once here so the render loop is clean.
    return (res.data ?? []) as Array<{
      id: string;
      deviceName: string;
      ipAddress: string;
      lastActiveAt?: string;
      createdAt: string;
    }>;
  }, [res]);

  const revokeMutation = useMutation({
    mutationFn: (id: string) => deleteUsersMeSessionsId(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: getGetUsersMeSessionsQueryKey(),
      });
    },
  });

  async function handleRevoke(id: string, isCurrent: boolean) {
    if (isCurrent) {
      const confirmed = window.confirm(
        "Revoking this session will log you out on this device. Continue?",
      );
      if (!confirmed) return;
    }
    await revokeMutation.mutateAsync(id);
    if (isCurrent) {
      // Server will reject subsequent requests; clear local state.
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
        <span className="text-xs text-muted-foreground">
          ({sessions.length})
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Every device with a valid refresh token. Revoking a session ends
        access immediately on that device.
      </p>

      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active sessions found.
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => {
            const isCurrent = s.id === currentSessionId;
            return (
              <li
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {s.deviceName || "Unknown device"}
                    </span>
                    {isCurrent && (
                      <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-500">
                        <Check className="h-3 w-3" />
                        This device
                      </span>
                    )}
                  </div>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <dt>IP</dt>
                    <dd className="font-mono">{s.ipAddress || "—"}</dd>
                    <dt>Signed in</dt>
                    <dd>{formatDate(s.createdAt)}</dd>
                    {s.lastActiveAt && (
                      <>
                        <dt>Last active</dt>
                        <dd>{formatDate(s.lastActiveAt)}</dd>
                      </>
                    )}
                  </dl>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(s.id, isCurrent)}
                  disabled={revokeMutation.isPending}
                  className="shrink-0 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50"
                  title={isCurrent ? "Log out of this device" : "Revoke session"}
                >
                  <LogOut className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
