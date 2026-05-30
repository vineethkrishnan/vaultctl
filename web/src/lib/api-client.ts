// SPDX-License-Identifier: AGPL-3.0-or-later

import { useAuthStore } from "./auth-store";

export interface ApiError {
  code: string;
  message: string;
  field?: string;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(error.message);
    this.name = "ApiRequestError";
  }
}

const BASE_URL = "";

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json();

  if (!res.ok) {
    const err = body?.error ?? { code: "UNKNOWN", message: res.statusText };
    throw new ApiRequestError(res.status, err);
  }

  return body as T;
}

let refreshPromise: Promise<void> | null = null;

async function refreshTokens(): Promise<void> {
  const { refreshToken, setTokens, logout } = useAuthStore.getState();
  if (!refreshToken) {
    logout();
    throw new ApiRequestError(401, {
      code: "SESSION_EXPIRED",
      message: "No refresh token",
    });
  }

  const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    logout();
    throw new ApiRequestError(401, {
      code: "SESSION_EXPIRED",
      message: "Refresh failed",
    });
  }

  const data = await res.json();
  setTokens(data.accessToken, data.refreshToken);
}

async function requestWithAuth(
  path: string,
  options: RequestInit,
  headers: Record<string, string>,
): Promise<Response> {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  let res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // Auto-refresh on 401
  if (res.status === 401 && accessToken) {
    if (!refreshPromise) {
      refreshPromise = refreshTokens().finally(() => {
        refreshPromise = null;
      });
    }
    await refreshPromise;

    const newToken = useAuthStore.getState().accessToken;
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
    }
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  }

  return res;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await requestWithAuth(path, options, {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  });
  return handleResponse<T>(res);
}

/** POST a multipart/form-data body (browser sets the boundary). */
export async function apiUpload<T>(
  path: string,
  form: FormData,
): Promise<T> {
  const res = await requestWithAuth(path, { method: "POST", body: form }, {});
  return handleResponse<T>(res);
}

/** GET a binary payload as raw bytes, returning the response headers too. */
export async function apiDownloadBytes(
  path: string,
): Promise<{ bytes: Uint8Array; headers: Headers }> {
  const res = await requestWithAuth(path, { method: "GET" }, {});
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = body?.error ?? { code: "UNKNOWN", message: res.statusText };
    throw new ApiRequestError(res.status, err);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, headers: res.headers };
}

// Convenience methods
export const apiGet = <T>(path: string) => api<T>(path, { method: "GET" });

export const apiPost = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "POST",
    body: body != null ? JSON.stringify(body) : undefined,
  });

export const apiPut = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "PUT",
    body: body != null ? JSON.stringify(body) : undefined,
  });

export const apiDelete = <T>(path: string) =>
  api<T>(path, { method: "DELETE" });
