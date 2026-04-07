/**
 * AES-256-GCM encrypt/decrypt via Web Crypto API.
 *
 * Produces EncryptedBlobs with alg=0x01 matching the Go backend's format:
 *   nonce (12B) + ciphertext (var) + tag (16B)
 *
 * Go's cipher.GCM.Seal returns ciphertext||tag concatenated.
 * Web Crypto's AES-GCM also returns ciphertext||tag concatenated.
 * We split them to match the blob wire format.
 */

import { AlgID, BLOB_VERSION, KEY_SIZE_256 } from "./algorithm.js";
import { type EncryptedBlob, serializeBlob, parseBlob } from "./blob.js";
import { buf } from "./utils.js";

const AES_GCM_NONCE_SIZE = 12;
const AES_GCM_TAG_SIZE = 16;

async function importAesKey(
  raw: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  if (raw.length !== KEY_SIZE_256) {
    throw new Error(
      `aes-gcm: key must be ${KEY_SIZE_256} bytes, got ${raw.length}`,
    );
  }
  return crypto.subtle.importKey(
    "raw",
    buf(raw),
    { name: "AES-GCM" },
    false,
    usages,
  );
}

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * @param key        - 32-byte symmetric key
 * @param plaintext  - Data to encrypt
 * @param aad        - Additional authenticated data (optional, for binding context)
 * @returns EncryptedBlob with alg=AES_256_GCM
 */
export async function aesGcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<EncryptedBlob> {
  const nonce = crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_SIZE));
  const cryptoKey = await importAesKey(key, ["encrypt"]);

  const params: AesGcmParams = {
    name: "AES-GCM",
    iv: buf(nonce),
    tagLength: AES_GCM_TAG_SIZE * 8,
  };
  if (aad) {
    params.additionalData = buf(aad);
  }

  // Web Crypto returns ciphertext || tag concatenated
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(params, cryptoKey, buf(plaintext)),
  );

  // Split: ciphertext is everything except the last 16 bytes (tag)
  const ciphertext = sealed.slice(0, sealed.length - AES_GCM_TAG_SIZE);
  const tag = sealed.slice(sealed.length - AES_GCM_TAG_SIZE);

  return {
    version: BLOB_VERSION,
    alg: AlgID.AES_256_GCM,
    nonce,
    ciphertext,
    tag,
  };
}

/**
 * Decrypt an AES-256-GCM EncryptedBlob.
 *
 * @param key   - 32-byte symmetric key
 * @param blob  - EncryptedBlob with alg=AES_256_GCM
 * @param aad   - Additional authenticated data (must match encrypt-time AAD)
 * @returns Decrypted plaintext
 */
export async function aesGcmDecrypt(
  key: Uint8Array,
  blob: EncryptedBlob,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  if (blob.alg !== AlgID.AES_256_GCM) {
    throw new Error(
      `aes-gcm: expected alg 0x01, got 0x${blob.alg.toString(16).padStart(2, "0")}`,
    );
  }

  const cryptoKey = await importAesKey(key, ["decrypt"]);

  // Reconstruct sealed = ciphertext || tag (what Web Crypto expects)
  const sealed = new Uint8Array(blob.ciphertext.length + blob.tag.length);
  sealed.set(blob.ciphertext, 0);
  sealed.set(blob.tag, blob.ciphertext.length);

  const params: AesGcmParams = {
    name: "AES-GCM",
    iv: buf(blob.nonce),
    tagLength: AES_GCM_TAG_SIZE * 8,
  };
  if (aad) {
    params.additionalData = buf(aad);
  }

  return new Uint8Array(
    await crypto.subtle.decrypt(params, cryptoKey, buf(sealed)),
  );
}

/**
 * Encrypt plaintext and return wire-format bytes.
 * Convenience wrapper combining aesGcmEncrypt + serializeBlob.
 */
export async function aesGcmEncryptToBytes(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const blob = await aesGcmEncrypt(key, plaintext, aad);
  return serializeBlob(blob);
}

/**
 * Parse wire-format bytes and decrypt.
 * Convenience wrapper combining parseBlob + aesGcmDecrypt.
 */
export async function aesGcmDecryptFromBytes(
  key: Uint8Array,
  raw: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const blob = parseBlob(raw);
  return aesGcmDecrypt(key, blob, aad);
}
