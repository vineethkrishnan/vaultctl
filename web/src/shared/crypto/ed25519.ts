// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ed25519 signing via Web Crypto API (Ed25519 support landed in all major
 * browsers as of 2024).
 *
 * Used for:
 *   - C1: identity keypair — signs the RSA public key
 *   - H1: wrap_signature — binds (vault_id || user_id || encrypted_vault_key)
 */

import { ED25519_SIGNATURE_SIZE } from "./algorithm.js";
import { buf } from "./utils.js";

export interface Ed25519KeyPair {
  publicKey: Uint8Array; // Raw 32 bytes
  privateKey: Uint8Array; // PKCS#8 DER
}

/** Generate a new Ed25519 keypair. */
export async function generateEd25519KeyPair(): Promise<Ed25519KeyPair> {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);

  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.exportKey("raw", keyPair.publicKey),
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  ]);

  return {
    publicKey: new Uint8Array(publicKey),
    privateKey: new Uint8Array(privateKey),
  };
}

/** Import a raw 32-byte Ed25519 public key for verification. */
export async function importEd25519PublicKey(
  raw: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", buf(raw), "Ed25519", false, [
    "verify",
  ]);
}

/** Import a PKCS#8 Ed25519 private key for signing. */
export async function importEd25519PrivateKey(
  pkcs8: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", buf(pkcs8), "Ed25519", false, [
    "sign",
  ]);
}

/**
 * Sign data with an Ed25519 private key.
 * Returns a 64-byte signature.
 */
export async function ed25519Sign(
  privateKey: CryptoKey,
  data: Uint8Array,
): Promise<Uint8Array> {
  const sig = new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, buf(data)),
  );

  if (sig.length !== ED25519_SIGNATURE_SIZE) {
    throw new Error(
      `ed25519: unexpected signature size ${sig.length}, expected ${ED25519_SIGNATURE_SIZE}`,
    );
  }

  return sig;
}

/** Verify an Ed25519 signature. */
export async function ed25519Verify(
  publicKey: CryptoKey,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  if (signature.length !== ED25519_SIGNATURE_SIZE) {
    return false;
  }

  return crypto.subtle.verify("Ed25519", publicKey, buf(signature), buf(data));
}

/**
 * Build the wrap_signature message for H1: vault_id || user_id || encrypted_vault_key.
 * Both IDs are UTF-8 encoded.
 */
export function buildWrapSignatureMessage(
  vaultId: string,
  userId: string,
  encryptedVaultKey: Uint8Array,
): Uint8Array {
  const encoder = new TextEncoder();
  const vaultIdBytes = encoder.encode(vaultId);
  const userIdBytes = encoder.encode(userId);

  const message = new Uint8Array(
    vaultIdBytes.length + userIdBytes.length + encryptedVaultKey.length,
  );
  message.set(vaultIdBytes, 0);
  message.set(userIdBytes, vaultIdBytes.length);
  message.set(encryptedVaultKey, vaultIdBytes.length + userIdBytes.length);

  return message;
}
