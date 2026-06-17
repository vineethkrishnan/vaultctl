// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Mobile key derivation: native Argon2id + shared HKDF.
 *
 * This replaces web/src/shared/crypto/kdf.ts for the mobile app. The logic
 * is identical but the Argon2id step uses the native C binding instead of
 * hash-wasm/WASM, keeping unlock time well under one second on device.
 */

import { deriveAuthHash, deriveStretchedKey } from '@vaultctl/shared/crypto/hkdf';
import { zero } from '@vaultctl/shared/crypto/utils';
import { deriveArgon2id, type KDFParams, DEFAULT_KDF_PARAMS } from './argon2';

export type { KDFParams };
export { DEFAULT_KDF_PARAMS };

export interface DerivedKeys {
  authHash: Uint8Array;
  stretchedKey: Uint8Array;
}

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
