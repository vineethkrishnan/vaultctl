// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * base64url codec (RFC 4648 section 5).
 *
 * WebAuthn carries every binary field as base64url. The vault's own crypto
 * layer uses standard base64 to match Go's base64.StdEncoding, so the two
 * live apart rather than retrofitting an encoding switch onto the key
 * hierarchy that the server also parses.
 */

import { fromBase64, toBase64 } from "../crypto/utils.js";

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (standard.length % 4)) % 4);
  return fromBase64(standard + padding);
}
