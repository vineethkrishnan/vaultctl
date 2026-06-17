// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Argon2id interop vector guard.
 *
 * The native react-native-argon2 binding cannot run under jest, so the actual
 * device derivation is verified at runtime by verifyArgon2idInterop() (wired
 * into app/_layout.tsx). This test covers what CI can:
 *
 *   1. The vectors embedded in argon2-vectors.ts are byte-identical to the
 *      canonical testdata/crypto/argon2_fixtures.json - they cannot drift.
 *   2. The reference Argon2id implementation (web hash-wasm, Node-runnable)
 *      reproduces each vector's master key, locking the parameter/salt mapping
 *      that the native binding must also satisfy.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { deriveArgon2id } from '@vaultctl/shared/crypto/argon2';
import { ARGON2_VECTORS, Argon2idVector } from '../../src/infrastructure/crypto/argon2-vectors';

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

const FIXTURE_PATH = join(__dirname, '../../../testdata/crypto/argon2_fixtures.json');

const canonicalFixtures: Argon2idVector[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

describe('Argon2id vector guard', () => {
  it('embedded vectors match the canonical fixture byte-for-byte', () => {
    expect(ARGON2_VECTORS).toEqual(canonicalFixtures);
  });

  it.each(ARGON2_VECTORS)(
    'reference hash-wasm reproduces master key ($password)',
    async (vector) => {
      const masterKey = await deriveArgon2id(vector.password, fromBase64(vector.salt_b64), {
        iterations: vector.iterations,
        memoryKB: vector.memory_kb,
        parallelism: vector.parallelism,
      });
      expect(toBase64(masterKey)).toBe(vector.master_key_b64);
    },
  );
});
