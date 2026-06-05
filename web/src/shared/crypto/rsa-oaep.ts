// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RSA-OAEP-SHA256-2048 via Web Crypto API.
 *
 * Used for encrypting vault keys in SHARED vaults (alg=0x02).
 * Key format: SPKI (public), PKCS#8 (private) - standard Web Crypto exports.
 */

import { AlgID, BLOB_VERSION, RSA_MODULUS_LENGTH } from "./algorithm.js";
import { type EncryptedBlob } from "./blob.js";
import { buf } from "./utils.js";

const RSA_ALGORITHM: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: RSA_MODULUS_LENGTH,
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
  hash: "SHA-256", // Must be SHA-256, not SHA-1 (architecture §4 note)
};

const RSA_IMPORT_ALGORITHM: RsaHashedImportParams = {
  name: "RSA-OAEP",
  hash: "SHA-256",
};

export interface RSAKeyPair {
  publicKey: Uint8Array; // SPKI DER
  privateKey: Uint8Array; // PKCS#8 DER
}

/** Generate a new RSA-2048 keypair. Returns raw DER bytes. */
export async function generateRSAKeyPair(): Promise<RSAKeyPair> {
  const keyPair = await crypto.subtle.generateKey(RSA_ALGORITHM, true, [
    "encrypt",
    "decrypt",
  ]);

  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.exportKey("spki", keyPair.publicKey),
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  ]);

  return {
    publicKey: new Uint8Array(publicKey),
    privateKey: new Uint8Array(privateKey),
  };
}

/** Import an SPKI public key for RSA-OAEP encryption. */
export async function importRSAPublicKey(
  spki: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    buf(spki),
    RSA_IMPORT_ALGORITHM,
    false,
    ["encrypt"],
  );
}

/** Import a PKCS#8 private key for RSA-OAEP decryption. */
export async function importRSAPrivateKey(
  pkcs8: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    buf(pkcs8),
    RSA_IMPORT_ALGORITHM,
    false,
    ["decrypt"],
  );
}

/**
 * Encrypt a vault key with an RSA-OAEP public key.
 * Returns an EncryptedBlob with alg=RSA_OAEP_SHA256.
 *
 * RSA-OAEP has no separate nonce or tag - the ciphertext is self-contained.
 */
export async function rsaOaepEncrypt(
  publicKey: CryptoKey,
  plaintext: Uint8Array,
): Promise<EncryptedBlob> {
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      buf(plaintext),
    ),
  );

  return {
    version: BLOB_VERSION,
    alg: AlgID.RSA_OAEP_SHA256,
    nonce: new Uint8Array(0),
    ciphertext,
    tag: new Uint8Array(0),
  };
}

/**
 * Decrypt an RSA-OAEP EncryptedBlob with a private key.
 */
export async function rsaOaepDecrypt(
  privateKey: CryptoKey,
  blob: EncryptedBlob,
): Promise<Uint8Array> {
  if (blob.alg !== AlgID.RSA_OAEP_SHA256) {
    throw new Error(
      `rsa-oaep: expected alg 0x02, got 0x${blob.alg.toString(16).padStart(2, "0")}`,
    );
  }

  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      buf(blob.ciphertext),
    ),
  );
}
