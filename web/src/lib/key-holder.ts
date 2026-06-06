// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Key custody facade - delegates to the crypto Web Worker (M9).
 *
 * The Worker holds all decrypted key material in an isolated scope. This
 * module provides the same async API that the rest of the app consumes.
 *
 * For the registration flow (where the Worker isn't yet initialized and we
 * need to generate keys in the main thread), crypto operations are imported
 * directly from shared/crypto - those calls don't go through this module.
 */

import {
  workerInit,
  workerEncrypt,
  workerDecrypt,
  workerEncryptName,
  workerDecryptName,
  workerLock,
  workerSignIdentity,
  workerWrapVaultKey,
  workerCreateVaultKey,
  workerBindVaultKey,
  workerTerminate,
  workerIsUnlocked,
} from "@/worker/worker-client";
import type {
  WrapVaultKeyResult,
  CreateVaultKeyResult,
} from "@/worker/worker-client";
import type { VaultMembership } from "@/shared/types/api";

export interface InitParams {
  stretchedKey: Uint8Array;
  encryptedPrivateKey: string; // base64 wire blob
  encryptedIdentityPrivateKey: string; // base64 wire blob
  vaults: VaultMembership[];
}

/** Initialize key custody after login - delegates to Worker. */
export async function initKeys(params: InitParams): Promise<void> {
  await workerInit({
    stretchedKey: params.stretchedKey,
    encryptedPrivateKey: params.encryptedPrivateKey,
    encryptedIdentityPrivateKey: params.encryptedIdentityPrivateKey,
    vaults: params.vaults.map((v) => ({
      vaultId: v.vaultId,
      encryptedVaultKey: v.encryptedVaultKey,
      vaultType: v.vaultType,
    })),
  });
}

/** Check if keys are loaded in the Worker. */
export async function isUnlocked(): Promise<boolean> {
  return workerIsUnlocked();
}

/** Encrypt item data for a vault. Returns base64 wire blob. */
export async function encryptData(
  vaultId: string,
  plaintext: Uint8Array,
): Promise<string> {
  return workerEncrypt(vaultId, plaintext);
}

/** Decrypt item data. Returns plaintext bytes. */
export async function decryptData(
  vaultId: string,
  encryptedB64: string,
): Promise<Uint8Array> {
  return workerDecrypt(vaultId, encryptedB64);
}

/** Encrypt an item name with 32-byte padding. Returns base64 wire blob. */
export async function encryptName(
  vaultId: string,
  name: string,
): Promise<string> {
  return workerEncryptName(vaultId, name);
}

/** Decrypt an item name (removes padding). Returns plain string. */
export async function decryptName(
  vaultId: string,
  encryptedB64: string,
): Promise<string> {
  return workerDecryptName(vaultId, encryptedB64);
}

/**
 * Sign arbitrary bytes with the Ed25519 identity private key. The private
 * key never leaves the Worker; only the signature bytes come back. Used by
 * the export-envelope flow (M9).
 */
export async function signIdentity(message: Uint8Array): Promise<Uint8Array> {
  return workerSignIdentity(message);
}

/**
 * Wrap a held vault key to a recipient and sign it for sharing (M8). The Worker
 * verifies the recipient's public key against their identity key, RSA-OAEP wraps
 * the raw vault key, and signs the wrap with the identity key. Returns the
 * base64 blob + signature ready to POST to the share endpoint.
 */
export async function wrapVaultKeyForRecipient(params: {
  vaultId: string;
  recipientUserId: string;
  recipientPublicKey: string;
  recipientIdentityPublicKey: string;
  recipientPublicKeySignature: string;
}): Promise<WrapVaultKeyResult> {
  return workerWrapVaultKey(params);
}

/**
 * Generate a fresh personal vault key for a new vault (M9). The Worker creates
 * the key, AES-KW wraps it under the held stretchedKey, and signs the wrap with
 * the identity key - mirroring the owner's self-wrap at registration. Returns
 * the base64 wrap blob + signature to POST to /vaults; the raw key is buffered
 * under `handle`. The raw vault key never leaves the Worker.
 */
export async function createVaultKey(
  handle: string,
): Promise<CreateVaultKeyResult> {
  return workerCreateVaultKey(handle);
}

/** Bind a buffered new-vault key (by handle) to its server-assigned vault id. */
export async function bindVaultKey(
  handle: string,
  vaultId: string,
): Promise<void> {
  return workerBindVaultKey(handle, vaultId);
}

/** Lock the vault: zero all key material in the Worker. */
export function lock(): void {
  workerLock();
}

/** Terminate the Worker entirely (on logout). */
export function terminate(): void {
  workerTerminate();
}
