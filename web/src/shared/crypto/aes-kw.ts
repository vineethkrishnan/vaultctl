// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AES-256 Key Wrap (NIST SP 800-38F / RFC 3394) via Web Crypto API.
 *
 * Used for personal vault key wrapping (alg=0x03).
 * The wrapped output = 8-byte integrity check (IV) + wrapped key material.
 * We map the 8-byte IV to the blob's `tag` field (tagSize=8, nonceSize=0).
 */

import { AlgID, BLOB_VERSION, KEY_SIZE_256 } from "./algorithm.js";
import { type EncryptedBlob } from "./blob.js";
import { buf } from "./utils.js";

const AES_KW_IV_SIZE = 8;

async function importKwKey(
  raw: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  if (raw.length !== KEY_SIZE_256) {
    throw new Error(
      `aes-kw: key must be ${KEY_SIZE_256} bytes, got ${raw.length}`,
    );
  }
  return crypto.subtle.importKey(
    "raw",
    buf(raw),
    { name: "AES-KW" },
    false,
    usages,
  );
}

/**
 * Wrap a key using AES-256 Key Wrap.
 *
 * @param wrappingKey - 32-byte wrapping key (e.g. stretchedKey)
 * @param keyToWrap   - Key material to wrap (must be multiple of 8 bytes)
 * @returns EncryptedBlob with alg=AES_256_KW
 */
export async function aesKeyWrap(
  wrappingKey: Uint8Array,
  keyToWrap: Uint8Array,
): Promise<EncryptedBlob> {
  if (keyToWrap.length % 8 !== 0 || keyToWrap.length === 0) {
    throw new Error(
      `aes-kw: key to wrap must be non-empty and multiple of 8 bytes, got ${keyToWrap.length}`,
    );
  }

  const cryptoWrappingKey = await importKwKey(wrappingKey, ["wrapKey"]);

  // Web Crypto's wrapKey needs a CryptoKey to wrap. Import the raw key as AES-KW
  // then wrapKey it. Alternatively, use the raw bytes approach.
  // The simplest: import keyToWrap as a raw AES key, then wrapKey.
  const keyToWrapCK = await crypto.subtle.importKey(
    "raw",
    buf(keyToWrap),
    { name: "AES-GCM" }, // Algorithm doesn't matter for export - we just need a CryptoKey
    true, // extractable so wrapKey can access raw bytes
    ["encrypt"],
  );

  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey("raw", keyToWrapCK, cryptoWrappingKey, "AES-KW"),
  );

  // AES-KW output = 8-byte IV prepended to wrapped key material.
  // Total: input_len + 8 bytes.
  // We split: tag = first 8 bytes (IV/integrity), ciphertext = rest.
  const tag = wrapped.slice(0, AES_KW_IV_SIZE);
  const ciphertext = wrapped.slice(AES_KW_IV_SIZE);

  return {
    version: BLOB_VERSION,
    alg: AlgID.AES_256_KW,
    nonce: new Uint8Array(0),
    ciphertext,
    tag,
  };
}

/**
 * Unwrap a key using AES-256 Key Wrap.
 *
 * @param wrappingKey - 32-byte wrapping key (e.g. stretchedKey)
 * @param blob        - EncryptedBlob with alg=AES_256_KW
 * @returns Unwrapped key material
 */
export async function aesKeyUnwrap(
  wrappingKey: Uint8Array,
  blob: EncryptedBlob,
): Promise<Uint8Array> {
  if (blob.alg !== AlgID.AES_256_KW) {
    throw new Error(
      `aes-kw: expected alg 0x03, got 0x${blob.alg.toString(16).padStart(2, "0")}`,
    );
  }

  const cryptoWrappingKey = await importKwKey(wrappingKey, ["unwrapKey"]);

  // Reconstruct wrapped bytes: tag (8-byte IV) + ciphertext
  const wrapped = new Uint8Array(blob.tag.length + blob.ciphertext.length);
  wrapped.set(blob.tag, 0);
  wrapped.set(blob.ciphertext, blob.tag.length);

  const unwrapped = await crypto.subtle.unwrapKey(
    "raw",
    buf(wrapped),
    cryptoWrappingKey,
    "AES-KW",
    { name: "AES-GCM" }, // Algorithm for the unwrapped key - doesn't affect raw bytes
    true,
    ["encrypt"],
  );

  return new Uint8Array(await crypto.subtle.exportKey("raw", unwrapped));
}
