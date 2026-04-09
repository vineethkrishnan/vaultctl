import { useAuthStore } from "./auth-store";

interface ApiError {
  code: string;
  message: string;
  field?: string;
}

class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(error.message);
    this.name = "ApiRequestError";
  }
}

const BASE_URL = "";

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

/**
 * Custom fetcher for Orval-generated hooks.
 * Handles Bearer auth injection and automatic 401 token refresh.
 */
export async function apiFetcher<T>(options: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  data?: unknown;
  signal?: AbortSignal;
}): Promise<T> {
  const { accessToken } = useAuthStore.getState();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  // Build URL with query params
  let url = `${BASE_URL}${options.url}`;
  if (options.params) {
    const search = new URLSearchParams(options.params).toString();
    if (search) url += `?${search}`;
  }

  const fetchOptions: RequestInit = {
    method: options.method,
    headers,
    signal: options.signal,
  };
  if (options.data !== undefined) {
    fetchOptions.body = JSON.stringify(options.data);
  }

  let res = await fetch(url, fetchOptions);

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
    res = await fetch(url, { ...fetchOptions, headers });
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  const body = await res.json();

  if (!res.ok) {
    const err = body?.error ?? { code: "UNKNOWN", message: res.statusText };
    throw new ApiRequestError(res.status, err);
  }

  return body as T;
}

export default apiFetcher;
