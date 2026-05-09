// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recovery Kit — M12.
 *
 * Registration flow:
 *   1. Generate recoveryKey = random 32 bytes
 *   2. recoveryWrappedPrivKey = AES-GCM-v1(recoveryKey, privateKey)
 *   3. Show recoveryKey to user ONCE (printable, QR)
 *   4. Server stores recoveryWrappedPrivKey; recoveryKey is never sent
 *
 * Recovery flow:
 *   1. User enters recoveryKey
 *   2. Decrypt recoveryWrappedPrivKey → privateKey
 *   3. Use privateKey to re-derive vault access
 */

import { KEY_SIZE_256 } from "./algorithm.js";
import { aesGcmEncrypt, aesGcmDecrypt } from "./aes-gcm.js";
import { type EncryptedBlob, serializeBlob, parseBlob } from "./blob.js";
import { toBase64 } from "./utils.js";

/**
 * Generate a recovery kit during registration.
 *
 * @param privateKey - The user's RSA private key (PKCS#8 DER bytes)
 * @returns recoveryKey (show to user once) + recoveryWrappedPrivKey (send to server)
 */
export async function generateRecoveryKit(privateKey: Uint8Array): Promise<{
  recoveryKey: Uint8Array;
  recoveryWrappedPrivKey: EncryptedBlob;
}> {
  const recoveryKey = crypto.getRandomValues(new Uint8Array(KEY_SIZE_256));
  const recoveryWrappedPrivKey = await aesGcmEncrypt(recoveryKey, privateKey);

  return { recoveryKey, recoveryWrappedPrivKey };
}

/**
 * Format recovery key as a human-readable string for display.
 * Base64-encoded, broken into groups of 4 for readability.
 */
export function formatRecoveryKey(recoveryKey: Uint8Array): string {
  const b64 = toBase64(recoveryKey);
  return b64.match(/.{1,4}/g)?.join("-") ?? b64;
}

/**
 * Parse a formatted recovery key string back to bytes.
 */
export function parseRecoveryKey(formatted: string): Uint8Array {
  const cleaned = formatted.replace(/-/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.length !== KEY_SIZE_256) {
    throw new Error(
      `recovery: invalid key length ${bytes.length}, expected ${KEY_SIZE_256}`,
    );
  }
  return bytes;
}

/**
 * Recover the private key using the recovery key.
 *
 * @param recoveryKey           - The 32-byte recovery key entered by user
 * @param recoveryWrappedPrivKey - The encrypted blob from server
 * @returns The decrypted RSA private key (PKCS#8 DER bytes)
 */
export async function recoverPrivateKey(
  recoveryKey: Uint8Array,
  recoveryWrappedPrivKey: EncryptedBlob,
): Promise<Uint8Array> {
  return aesGcmDecrypt(recoveryKey, recoveryWrappedPrivKey);
}

/**
 * Recover from wire-format bytes.
 */
export async function recoverPrivateKeyFromBytes(
  recoveryKey: Uint8Array,
  raw: Uint8Array,
): Promise<Uint8Array> {
  const blob = parseBlob(raw);
  return aesGcmDecrypt(recoveryKey, blob);
}

/**
 * Serialize a recovery wrapped key to wire-format bytes for sending to server.
 */
export function serializeRecoveryBlob(blob: EncryptedBlob): Uint8Array {
  return serializeBlob(blob);
}
