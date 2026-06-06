// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Silent session restore on cold load.
 *
 * The access token is in-memory only; the refresh token + session id live in
 * sessionStorage. A full-page reload (or returning from a cloud-OAuth consent
 * redirect) wipes the in-memory access token, so the route guard would
 * otherwise see no access token and bounce to /login - logging the user out.
 *
 * On bootstrap, if a refresh token exists but there's no access token, we
 * exchange the refresh token for a fresh access token and mark the session
 * authenticated-but-LOCKED: the crypto worker has no vault keys (they derive
 * from the master password at login), so the vault is not usable until the user
 * re-enters their master password on /lock. Genuinely unauthenticated users (no
 * refresh token) are left untouched and still land on /login.
 */

import { useAuthStore } from "./auth-store";
import { decodeAccessTokenClaims } from "./jwt-claims";

let restorePromise: Promise<void> | null = null;

/**
 * Attempt a one-shot silent refresh. Idempotent: concurrent/repeated calls
 * share the same in-flight promise, and once the store is authenticated it's a
 * no-op. Never throws - a failed refresh just leaves the user unauthenticated
 * so the guard sends them to /login.
 */
export async function restoreSession(): Promise<void> {
  const state = useAuthStore.getState();
  if (state.isAuthenticated || state.accessToken) return;

  const refreshToken = sessionStorage.getItem("vaultctl_rt");
  if (!refreshToken) return;

  if (!restorePromise) {
    restorePromise = doRestore(refreshToken).finally(() => {
      restorePromise = null;
    });
  }
  return restorePromise;
}

async function doRestore(refreshToken: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return;
  }

  if (!res.ok) {
    useAuthStore.getState().logout();
    return;
  }

  const data = (await res.json()) as {
    accessToken?: string;
    refreshToken?: string;
  };
  if (!data.accessToken || !data.refreshToken) return;

  const claims = decodeAccessTokenClaims(data.accessToken);
  useAuthStore.getState().restoreLocked({
    userId: claims?.userId ?? useAuthStore.getState().userId ?? "",
    role: claims?.role ?? useAuthStore.getState().role ?? "",
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
}
