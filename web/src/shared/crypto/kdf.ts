// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Full key derivation orchestrator: password + salt → {authHash, stretchedKey}.
 *
 * Flow (architecture §6.1):
 *   1. Argon2id(password, salt, params) → masterKey (32B)
 *   2. HKDF-SHA256(masterKey, info="auth") → authHash (32B) - sent to server
 *   3. HKDF-SHA256(masterKey, info="enc")  → stretchedKey (32B) - local encryption
 *   4. Zero masterKey
 */

import { type KDFParams, DEFAULT_KDF_PARAMS, deriveArgon2id } from "./argon2.js";
import { deriveAuthHash, deriveStretchedKey } from "./hkdf.js";
import { zero } from "./utils.js";

export { type KDFParams, DEFAULT_KDF_PARAMS };

export interface DerivedKeys {
  authHash: Uint8Array;
  stretchedKey: Uint8Array;
}

/**
 * Derive authHash and stretchedKey from a master password.
 *
 * @param password - UTF-8 master password (never stored)
 * @param salt     - Per-user salt from prelogin (at least 16 bytes)
 * @param params   - KDF parameters from prelogin response
 */
export async function deriveKeys(
  password: string,
  salt: Uint8Array,
  params: KDFParams = DEFAULT_KDF_PARAMS,
): Promise<DerivedKeys> {
  const masterKey = await deriveArgon2id(password, salt, params);

  try {
    const [authHash, stretchedKey] = await Promise.all([
      deriveAuthHash(masterKey),
      deriveStretchedKey(masterKey),
    ]);

    return { authHash, stretchedKey };
  } finally {
    zero(masterKey);
  }
}
