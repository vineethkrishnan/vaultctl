// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Algorithm identifiers and constants mirroring the Go domain/crypto package.
 * This is the single source of truth for the TS client - any change here
 * MUST match the Go side or interop tests will break.
 */

// Blob envelope version. Bump only when the envelope shape itself changes.
export const BLOB_VERSION = 0x01 as const;

/** Algorithm identifier byte values (PRD §9.9). */
export const AlgID = {
  /** AES-256-GCM: 96-bit nonce, 128-bit tag. Items, keys, names. */
  AES_256_GCM: 0x01,
  /** RSA-OAEP-SHA256-2048: shared vault key wrapping. */
  RSA_OAEP_SHA256: 0x02,
  /** AES-256 Key Wrap (NIST SP 800-38F): personal vault key wrapping. */
  AES_256_KW: 0x03,
} as const;

export type AlgID = (typeof AlgID)[keyof typeof AlgID];

const VALID_ALG_IDS = new Set<number>([
  AlgID.AES_256_GCM,
  AlgID.RSA_OAEP_SHA256,
  AlgID.AES_256_KW,
]);

export function isValidAlgId(id: number): id is AlgID {
  return VALID_ALG_IDS.has(id);
}

/** Nonce size in bytes per algorithm. */
export function nonceSize(alg: AlgID): number {
  switch (alg) {
    case AlgID.AES_256_GCM:
      return 12;
    default:
      return 0;
  }
}

/** Authentication tag size in bytes per algorithm. */
export function tagSize(alg: AlgID): number {
  switch (alg) {
    case AlgID.AES_256_GCM:
      return 16;
    case AlgID.AES_256_KW:
      return 8;
    default:
      return 0;
  }
}

// Symmetric key sizes
export const KEY_SIZE_256 = 32;

// Ed25519 signature size
export const ED25519_SIGNATURE_SIZE = 64;

// RSA key size for OAEP wrapping
export const RSA_MODULUS_LENGTH = 2048;
