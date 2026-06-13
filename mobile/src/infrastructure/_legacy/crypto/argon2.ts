// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Native Argon2id binding for React Native.
 *
 * react-native-argon2 wraps the reference C implementation via JSI.
 * It is orders of magnitude faster than hash-wasm/WASM in Hermes for the
 * 64 MiB default memory cost. Requires a custom dev client (not Expo Go).
 *
 * The interface is byte-identical to web/src/shared/crypto/argon2.ts:
 * same input → same 32-byte output. Verified by the shared test-vector suite.
 */

import argon2 from 'react-native-argon2';
import type { KDFParams } from '@vaultctl/shared/crypto/argon2';
import { KEY_SIZE_256 } from '@vaultctl/shared/crypto/algorithm';

export type { KDFParams };

export const DEFAULT_KDF_PARAMS: Readonly<KDFParams> = {
  iterations: 3,
  memoryKB: 65536,
  parallelism: 4,
};

/**
 * Derive a 32-byte master key from password + salt using Argon2id.
 *
 * The salt is passed as a hex string with saltEncoding:'hex' so the native
 * library feeds the raw binary bytes to the C argon2 implementation unchanged,
 * producing byte-identical output to the WASM path on web.
 *
 * IMPORTANT: verify with the shared test-vector suite before shipping
 * (web/src/shared/crypto/interop-fixtures.test.ts includes KDF vectors).
 */
export async function deriveArgon2id(
  password: string,
  salt: Uint8Array,
  params: KDFParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  if (salt.length < 16) {
    throw new Error('argon2: salt must be at least 16 bytes');
  }

  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const result = await argon2(password, saltHex, {
    iterations: params.iterations,
    memory: params.memoryKB,
    parallelism: params.parallelism,
    hashLength: KEY_SIZE_256,
    mode: 'argon2id',
    saltEncoding: 'hex',
  });

  const hex = result.rawHash;
  const out = new Uint8Array(KEY_SIZE_256);
  for (let i = 0; i < KEY_SIZE_256; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
