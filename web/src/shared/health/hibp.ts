// SPDX-License-Identifier: AGPL-3.0-or-later

// HaveIBeenPwned breach check via the k-anonymity range API. The full password
// and its full SHA-1 hash never leave the browser: we send only the first five
// hex characters of the SHA-1 hash as the range prefix, then match the
// remaining 35-character suffix locally against the returned list (FEAT-4).
//
// The outbound request goes directly to api.pwnedpasswords.com, not through the
// vaultctl server, so the server learns nothing about the check either.

import { sha1 } from "../crypto/utils.js";

const RANGE_API = "https://api.pwnedpasswords.com/range/";

function toUpperHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex.toUpperCase();
}

// parseBreachCount finds the breach count for a SHA-1 suffix in a range-API
// response body. Each line is "SUFFIX:COUNT" (suffix uppercased, 35 hex chars).
// Returns 0 when the suffix is absent (not in any known breach corpus).
export function parseBreachCount(body: string, suffix: string): number {
  const wanted = suffix.toUpperCase();
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    if (line.slice(0, separatorIndex).toUpperCase() !== wanted) continue;
    const count = Number.parseInt(line.slice(separatorIndex + 1), 10);
    return Number.isFinite(count) ? count : 0;
  }
  return 0;
}

// breachCountForPassword SHA-1s the password, sends only the 5-char prefix to
// the range API, and resolves the breach count by matching the suffix locally.
export async function breachCountForPassword(password: string): Promise<number> {
  const digest = await sha1(new TextEncoder().encode(password));
  const hash = toUpperHex(digest);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const response = await fetch(`${RANGE_API}${prefix}`, {
    headers: { "Add-Padding": "true" },
  });
  if (!response.ok) {
    throw new Error(`HIBP range request failed: ${response.status}`);
  }
  const body = await response.text();
  return parseBreachCount(body, suffix);
}
