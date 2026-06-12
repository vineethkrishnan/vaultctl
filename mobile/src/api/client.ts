// SPDX-License-Identifier: AGPL-3.0-or-later

import { useServerStore } from '../store/server';
import { useAuthStore } from '../store/auth';

let refreshPromise: Promise<void> | null = null;

async function refreshTokens(): Promise<void> {
  const { refreshToken, setTokens, logout } = useAuthStore.getState();
  if (!refreshToken) {
    await logout();
    throw new Error('SESSION_EXPIRED');
  }

  const baseUrl = useServerStore.getState().serverUrl;
  const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    await logout();
    throw new Error('SESSION_EXPIRED');
  }

  const body = await res.json();
  await setTokens(body.accessToken, body.refreshToken);
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const { accessToken } = useAuthStore.getState();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return headers;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResponse<T>> {
  const baseUrl = useServerStore.getState().serverUrl;
  if (!baseUrl) throw new Error('No server URL configured');

  const url = `${baseUrl}/api/v1${path}`;

  const doRequest = (): Promise<Response> =>
    fetch(url, { ...init, headers: buildHeaders(init) });

  let res = await doRequest();

  if (res.status === 401) {
    if (!refreshPromise) {
      refreshPromise = refreshTokens().finally(() => {
        refreshPromise = null;
      });
    }
    await refreshPromise;
    res = await doRequest();
  }

  const text = await res.text();
  const data: T =
    res.status === 204 || !text
      ? (undefined as T)
      : (() => {
          try {
            return JSON.parse(text) as T;
          } catch {
            return text as unknown as T;
          }
        })();

  return { data, status: res.status };
}
