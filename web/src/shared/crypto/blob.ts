// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * EncryptedBlob — versioned ciphertext envelope (PRD §9.9, C5).
 *
 * Wire format (concatenated bytes):
 *   version (1B) || alg_id (1B) || nonce (NonceSize) || ciphertext (var) || tag (TagSize)
 *
 * Byte-identical to Go's domain/crypto.EncryptedBlob.
 */

import {
  BLOB_VERSION,
  type AlgID,
  isValidAlgId,
  nonceSize,
  tagSize,
} from "./algorithm.js";

export class MalformedBlobError extends Error {
  constructor(message: string) {
    super(`crypto: malformed encrypted blob: ${message}`);
    this.name = "MalformedBlobError";
  }
}

export interface EncryptedBlob {
  version: number;
  alg: AlgID;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

/** Validate an EncryptedBlob against its algorithm's invariants. */
export function validateBlob(b: EncryptedBlob): void {
  if (b.version !== BLOB_VERSION) {
    throw new MalformedBlobError(
      `unsupported version 0x${b.version.toString(16).padStart(2, "0")}`,
    );
  }
  if (!isValidAlgId(b.alg as number)) {
    throw new MalformedBlobError(
      `unknown alg 0x${(b.alg as number).toString(16).padStart(2, "0")}`,
    );
  }

  const wantNonce = nonceSize(b.alg);
  if (b.nonce.length !== wantNonce) {
    throw new MalformedBlobError(
      `nonce len=${b.nonce.length} want ${wantNonce}`,
    );
  }

  const wantTag = tagSize(b.alg);
  if (b.tag.length !== wantTag) {
    throw new MalformedBlobError(`tag len=${b.tag.length} want ${wantTag}`);
  }

  if (b.alg === 0x01 && b.ciphertext.length === 0) {
    throw new MalformedBlobError("empty ciphertext for AES-256-GCM");
  }
}

/** Serialize an EncryptedBlob to wire format. */
export function serializeBlob(b: EncryptedBlob): Uint8Array {
  validateBlob(b);
  const out = new Uint8Array(
    2 + b.nonce.length + b.ciphertext.length + b.tag.length,
  );
  out[0] = b.version;
  out[1] = b.alg;
  let offset = 2;
  out.set(b.nonce, offset);
  offset += b.nonce.length;
  out.set(b.ciphertext, offset);
  offset += b.ciphertext.length;
  out.set(b.tag, offset);
  return out;
}

/** Parse wire-format bytes into an EncryptedBlob. */
export function parseBlob(raw: Uint8Array): EncryptedBlob {
  if (raw.length < 2) {
    throw new MalformedBlobError(`input too short (${raw.length} bytes)`);
  }

  const version = raw[0]!;
  const algByte = raw[1]!;

  if (version !== BLOB_VERSION) {
    throw new MalformedBlobError(
      `unsupported version 0x${version.toString(16).padStart(2, "0")}`,
    );
  }
  if (!isValidAlgId(algByte)) {
    throw new MalformedBlobError(
      `unknown alg 0x${algByte.toString(16).padStart(2, "0")}`,
    );
  }

  const alg = algByte as AlgID;
  const nonceLen = nonceSize(alg);
  const tagLen = tagSize(alg);
  const body = raw.subarray(2);

  if (body.length < nonceLen + tagLen) {
    throw new MalformedBlobError(
      `body too short for alg (len=${body.length})`,
    );
  }

  const nonce = body.slice(0, nonceLen);
  const remaining = body.subarray(nonceLen);
  const ctLen = remaining.length - tagLen;
  const ciphertext = remaining.slice(0, ctLen);
  const tag = tagLen > 0 ? remaining.slice(ctLen) : new Uint8Array(0);

  const blob: EncryptedBlob = { version, alg, nonce, ciphertext, tag };
  validateBlob(blob);
  return blob;
}
