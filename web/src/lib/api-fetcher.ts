// SPDX-License-Identifier: AGPL-3.0-or-later

import { useAuthStore } from "./auth-store";

const BASE_URL = "/api/v1";

let refreshPromise: Promise<void> | null = null;

async function refreshTokens(): Promise<void> {
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
  if (res.status === 204) return undefined;
  const ct = res.headers.get("Content-Type") ?? "";
  if (ct.includes("application/json")) {
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return res.text();
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
