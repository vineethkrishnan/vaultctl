// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * HKDF-SHA256 context derivations via Web Crypto API.
 *
 * masterKey → HKDF(info="auth") → authHash  (sent to server)
 * masterKey → HKDF(info="enc")  → stretchedKey (encrypts private keys locally)
 *
 * Architecture §6.1 defines these two fixed context strings.
 */

import { KEY_SIZE_256 } from "./algorithm.js";
import { buf } from "./utils.js";

const HKDF_HASH = "SHA-256";

const encoder = new TextEncoder();
const CONTEXT_AUTH = encoder.encode("auth");
const CONTEXT_ENC = encoder.encode("enc");

/**
 * Derive a 32-byte key from ikm using HKDF-SHA256.
 *
 * @param ikm   - Input keying material (e.g. masterKey from Argon2id)
 * @param info  - Context/info bytes
 * @param salt  - Optional salt (empty = zero-filled per RFC 5869)
 */
async function hkdfDerive(
  ikm: Uint8Array,
  info: Uint8Array,
  salt: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    buf(ikm),
    "HKDF",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: HKDF_HASH, salt: buf(salt), info: buf(info) },
    baseKey,
    KEY_SIZE_256 * 8,
  );

  return new Uint8Array(bits);
}

/** Derive authHash from masterKey. Sent to server for login. */
export async function deriveAuthHash(
  masterKey: Uint8Array,
): Promise<Uint8Array> {
  return hkdfDerive(masterKey, CONTEXT_AUTH);
}

/** Derive stretchedKey from masterKey. Used locally to encrypt private keys. */
export async function deriveStretchedKey(
  masterKey: Uint8Array,
): Promise<Uint8Array> {
  return hkdfDerive(masterKey, CONTEXT_ENC);
}
