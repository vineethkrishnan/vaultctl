// SPDX-License-Identifier: AGPL-3.0-or-later

export const REQUEST_TIMEOUT_MS = 10_000;
export const STARTUP_REQUEST_TIMEOUT_MS = 5_000;

type ApiError = Error & { code: string };

interface ApiOptions {
  method?: string;
  token?: string;
  body?: unknown;
  timeoutMs?: number;
}

function apiError(message: string, code: string): ApiError {
  const error = new Error(message) as ApiError;
  error.code = code;
  return error;
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

function transportError(error: unknown, base: string, timeoutMs: number): ApiError {
  if (isTimeout(error)) {
    return apiError(
      `The server at ${base} did not respond within ${Math.round(timeoutMs / 1000)} seconds. Check that it is running and reachable from this device.`,
      "TIMEOUT",
    );
  }
  // fetch rejects with a bare TypeError ("Failed to fetch" / "Load failed" /
  // "NetworkError ...") for DNS, connection-refused, TLS and CORS failures -
  // none of which are legible to a user. Map them all to one clear message.
  return apiError(
    `Can't reach the server at ${base}. Check the address is correct and that the server is running.`,
    "NETWORK_ERROR",
  );
}

export async function api<T>(
  serverUrl: string,
  path: string,
  opts: ApiOptions = {},
): Promise<T> {
  const base = serverUrl.replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        // Only set Content-Type when there is a body. On a bodyless GET it is
        // a non-safelisted header that forces a CORS preflight, which the
        // health check does not need and some setups (Firefox without the
        // host grant) reject.
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (error) {
    throw transportError(error, base, timeoutMs);
  }

  let json: { error?: { code?: string; message?: string } } = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw apiError(
        `${base} returned an unexpected response. Make sure the URL points to a vaultctl server.`,
        "BAD_RESPONSE",
      );
    }
  }
  if (!res.ok) {
    const code = json?.error?.code;
    const message = json?.error?.message ?? `Server error (HTTP ${res.status}).`;
    throw apiError(message, code ?? `HTTP_${res.status}`);
  }
  return json as T;
}
