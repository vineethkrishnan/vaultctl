// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * On-device Argon2id self-check.
 *
 * The native react-native-argon2 (JSI) binding cannot run under jest, so the
 * cross-implementation interop suite (web hash-wasm, Go x/crypto/argon2) never
 * exercises it. This runs the native binding against the same canonical vectors
 * those suites verify, and throws if the device produces a different master key
 * - catching native-binding drift (salt encoding, parameter mapping, library
 * version) that would otherwise silently break login interop with the backend.
 *
 * ARGON2_VECTORS is asserted byte-identical to testdata/crypto/argon2_fixtures.json
 * by __tests__/crypto/argon2-vector.test.ts, so the embedded copy cannot drift
 * from the canonical fixture.
 */

import { fromBase64, toBase64 } from '@vaultctl/shared/crypto/utils';
import { deriveArgon2id } from '../_legacy/crypto/argon2';
import { ARGON2_VECTORS } from './argon2-vectors';

export async function verifyArgon2idInterop(): Promise<void> {
  for (const vector of ARGON2_VECTORS) {
    const masterKey = await deriveArgon2id(vector.password, fromBase64(vector.salt_b64), {
      iterations: vector.iterations,
      memoryKB: vector.memory_kb,
      parallelism: vector.parallelism,
    });
    const got = toBase64(masterKey);
    if (got !== vector.master_key_b64) {
      throw new Error(
        `Argon2id self-check failed for "${vector.password}": native binding produced ${got}, expected ${vector.master_key_b64}. ` +
          'The device Argon2id does not match the canonical interop vector - login keys will not match the backend.',
      );
    }
  }
}
