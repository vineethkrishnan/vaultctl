// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ASN.1 DER encoding of an ECDSA signature.
 *
 * Web Crypto returns an ECDSA signature as a fixed-width r||s pair, but
 * WebAuthn relying parties verify a DER SEQUENCE of two INTEGERs. DER
 * integers are signed and minimally encoded, so each half has its leading
 * zero bytes stripped and gains a 0x00 prefix when its top bit is set -
 * without that prefix a verifier reads the value as negative and the
 * assertion fails with nothing to go on but "invalid signature".
 */

import { concat } from "../crypto/utils.js";

export function rawEcdsaToDer(raw: Uint8Array): Uint8Array {
  if (raw.length === 0 || raw.length % 2 !== 0) {
    throw new Error("raw ECDSA signature must be a non-empty even length");
  }
  const half = raw.length / 2;
  const body = concat(
    derInteger(raw.subarray(0, half)),
    derInteger(raw.subarray(half)),
  );
  return concat(Uint8Array.of(0x30), derLength(body.length), body);
}

function derInteger(value: Uint8Array): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start++;
  const trimmed = value.subarray(start);
  const content =
    (trimmed[0]! & 0x80) !== 0 ? concat(Uint8Array.of(0x00), trimmed) : trimmed;
  return concat(Uint8Array.of(0x02), derLength(content.length), content);
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  if (length < 0x100) return Uint8Array.of(0x81, length);
  throw new Error(`der: length ${length} out of range for a signature`);
}
