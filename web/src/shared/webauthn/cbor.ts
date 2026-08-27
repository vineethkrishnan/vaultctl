// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Minimal CBOR encoder for the two structures WebAuthn asks an authenticator
 * to produce: the COSE public key and the attestation object.
 *
 * Encode-only by design - nothing on the authenticator's write path needs to
 * read CBOR back, so a decoder would be untested surface area.
 *
 * Map keys are emitted in CTAP2 canonical order (shorter encoded key first,
 * then bytewise), so callers never have to know the ordering rules.
 */

import { concat } from "../crypto/utils.js";

export type CborValue = number | string | Uint8Array | CborValue[] | CborMap;
export type CborMap = Map<number | string, CborValue>;

const MAJOR_UNSIGNED = 0;
const MAJOR_NEGATIVE = 1;
const MAJOR_BYTES = 2;
const MAJOR_TEXT = 3;
const MAJOR_ARRAY = 4;
const MAJOR_MAP = 5;

export function encodeCbor(value: CborValue): Uint8Array {
  if (typeof value === "number") return encodeNumber(value);
  if (typeof value === "string") {
    const utf8 = new TextEncoder().encode(value);
    return concat(head(MAJOR_TEXT, utf8.length), utf8);
  }
  if (value instanceof Uint8Array) {
    return concat(head(MAJOR_BYTES, value.length), value);
  }
  if (Array.isArray(value)) {
    return concat(head(MAJOR_ARRAY, value.length), ...value.map(encodeCbor));
  }
  return encodeMap(value);
}

function encodeMap(map: CborMap): Uint8Array {
  const entries = [...map.entries()]
    .map(([key, value]) => ({
      key: typeof key === "number" ? encodeNumber(key) : encodeCbor(key),
      value: encodeCbor(value),
    }))
    .sort((a, b) => compareCanonical(a.key, b.key));
  return concat(
    head(MAJOR_MAP, entries.length),
    ...entries.flatMap((entry) => [entry.key, entry.value]),
  );
}

function compareCanonical(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

function encodeNumber(value: number): Uint8Array {
  if (!Number.isInteger(value)) {
    throw new Error(`cbor: ${value} is not an integer`);
  }
  return value >= 0
    ? head(MAJOR_UNSIGNED, value)
    : head(MAJOR_NEGATIVE, -value - 1);
}

function head(major: number, value: number): Uint8Array {
  const prefix = major << 5;
  if (value < 24) return Uint8Array.of(prefix | value);
  if (value < 0x100) return Uint8Array.of(prefix | 24, value);
  if (value < 0x10000) {
    return Uint8Array.of(prefix | 25, value >> 8, value & 0xff);
  }
  if (value <= 0xffffffff) {
    return Uint8Array.of(
      prefix | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }
  throw new Error(`cbor: ${value} exceeds the supported 32-bit range`);
}
