// SPDX-License-Identifier: AGPL-3.0-or-later

import { getAuthEpoch, useAuthStore } from "./auth-store";

const BASE_URL = "/api/v1";

let refreshPromise: Promise<void> | null = null;

async function refreshTokens(): Promise<void> {
  const epoch = getAuthEpoch();
  const { refreshToken, setTokens, logout } = useAuthStore.getState();
  if (!refreshToken) {
    logout();
    throw new Error("SESSION_EXPIRED");
  }

  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    logout();
    throw new Error("SESSION_EXPIRED");
  }

  const body = await res.json();
  // A logout while this refresh was in flight bumps the epoch. Applying the
  // rotated token now would resurrect the session in sessionStorage after the
  // user signed out, so drop the result.
  if (getAuthEpoch() !== epoch) return;
  setTokens(body.accessToken, body.refreshToken);
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const { accessToken } = useAuthStore.getState();
  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return headers;
}

async function readBody(res: Response): Promise<unknown> {
  // Always drain the body. Skipping res.text()/json() leaves the response
  // stream live until GC, at which point Chromium aborts the request and
  // network observers (Playwright requestfinished, perf hooks) miss it.
  const text = await res.text();
  if (res.status === 204 || !text) return undefined;
  const ct = res.headers.get("Content-Type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export async function apiFetcher<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const fullUrl = url.startsWith("http") ? url : `${BASE_URL}${url}`;

  let res = await fetch(fullUrl, { ...init, headers: buildHeaders(init) });

  if (
    res.status === 401 &&
    useAuthStore.getState().accessToken &&
    !url.includes("/auth/refresh") &&
    !url.includes("/auth/login")
  ) {
    if (!refreshPromise) {
      refreshPromise = refreshTokens().finally(() => {
        refreshPromise = null;
      });
    }
    try {
      await refreshPromise;
      res = await fetch(fullUrl, { ...init, headers: buildHeaders(init) });
    } catch {
      // Fall through with original 401 response
    }
  }

  const data = await readBody(res);

  return {
    data,
    status: res.status,
    headers: res.headers,
  } as T;
}

export default apiFetcher;
