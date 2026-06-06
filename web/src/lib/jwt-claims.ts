// SPDX-License-Identifier: AGPL-3.0-or-later

export interface AccessTokenClaims {
  userId: string;
  role: string;
}

/**
 * Decode the unverified claims from a JWT access token. The token is signed by
 * the server and verified there on every request; client-side we only read
 * `sub` (userId) and `role` to populate the store after a silent refresh.
 * Returns null if the token isn't a well-formed JWT with a JSON payload.
 */
export function decodeAccessTokenClaims(token: string): AccessTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadJson = base64UrlDecode(parts[1]!);
    const payload = JSON.parse(payloadJson) as { sub?: unknown; role?: unknown };
    if (typeof payload.sub !== "string") return null;
    return {
      userId: payload.sub,
      role: typeof payload.role === "string" ? payload.role : "",
    };
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  return atob(padded);
}
