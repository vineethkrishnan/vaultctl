// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Argon2id key derivation via hash-wasm (WASM).
 *
 * Client-side defaults match Go's DefaultKDFParams:
 *   iterations=3, memoryKB=65536 (64 MiB), parallelism=4
 */

import { argon2id } from "hash-wasm";
import { KEY_SIZE_256 } from "./algorithm.js";

export interface KDFParams {
  iterations: number;
  memoryKB: number;
  parallelism: number;
}

export const DEFAULT_KDF_PARAMS: Readonly<KDFParams> = {
  iterations: 3,
  memoryKB: 65536,
  parallelism: 4,
};

/**
 * Derive a 32-byte master key from password + salt using Argon2id.
 *
 * @param password  - UTF-8 master password
 * @param salt      - Per-user salt (at least 16 bytes, from prelogin)
 * @param params    - KDF parameters (from server's prelogin response)
 * @returns 32-byte Uint8Array (masterKey)
 */
export async function deriveArgon2id(
  password: string,
  salt: Uint8Array,
  params: KDFParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  if (salt.length < 16) {
    throw new Error("argon2: salt must be at least 16 bytes");
  }

  const hash = await argon2id({
    password,
    salt,
    iterations: params.iterations,
    memorySize: params.memoryKB,
    parallelism: params.parallelism,
    hashLength: KEY_SIZE_256,
    outputType: "binary",
  });

  return new Uint8Array(hash);
}
