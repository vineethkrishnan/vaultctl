// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * In-memory key holder for mobile.
 *
 * On the web, key material lives in a Web Worker. React Native has no Web
 * Workers, so we use a module-level closure instead. The contract is the
 * same: keys are never accessible outside this module, only through the
 * named operations exported here. lock() zeros everything.
 */

import {
  aesGcmEncrypt,
  aesGcmDecrypt,
  aesKeyUnwrap,
  rsaOaepDecrypt,
  importRSAPrivateKey,
  parseBlob,
  serializeBlob,
  toBase64,
  fromBase64,
  pad,
  unpad,
} from '@vaultctl/shared/crypto';
import type { VaultMembership } from '@vaultctl/shared/types/api';

interface KeyState {
  stretchedKey: Uint8Array | null;
  vaultKeys: Map<string, Uint8Array>;
}

let state: KeyState = {
  stretchedKey: null,
  vaultKeys: new Map(),
};

export interface InitParams {
  stretchedKey: Uint8Array;
  encryptedPrivateKey: string;
  vaults: Pick<VaultMembership, 'vaultId' | 'encryptedVaultKey' | 'vaultType'>[];
}

/**
 * Initialize key custody after login or biometric unlock.
 * Unwraps each vault key using the stretchedKey.
 */
export async function initKeys(params: InitParams): Promise<void> {
  const { stretchedKey, encryptedPrivateKey, vaults } = params;

  // Decrypt the RSA private key for use with shared vault key unwrapping.
  const privateKeyBlob = parseBlob(fromBase64(encryptedPrivateKey));
  const privateKeyBytes = await aesGcmDecrypt(stretchedKey, privateKeyBlob);
  const rsaPrivateKey = await importRSAPrivateKey(privateKeyBytes);

  const vaultKeyMap = new Map<string, Uint8Array>();

  for (const v of vaults) {
    const rawWrapped = fromBase64(v.encryptedVaultKey);
    const wrappedBlob = parseBlob(rawWrapped);
    let rawVaultKey: Uint8Array;

    if (v.vaultType === 'personal') {
      // Personal vault: AES-KW wrapped under stretchedKey.
      rawVaultKey = await aesKeyUnwrap(stretchedKey, wrappedBlob);
    } else {
      // Shared vault: RSA-OAEP wrapped under RSA private key.
      rawVaultKey = await rsaOaepDecrypt(rsaPrivateKey, wrappedBlob);
    }

    vaultKeyMap.set(v.vaultId, rawVaultKey);
  }

  state = {
    stretchedKey: new Uint8Array(stretchedKey),
    vaultKeys: vaultKeyMap,
  };
}

function requireVaultKey(vaultId: string): Uint8Array {
  const key = state.vaultKeys.get(vaultId);
  if (!key) throw new Error(`No key loaded for vault ${vaultId}`);
  return key;
}

export function isUnlocked(): boolean {
  return state.stretchedKey !== null;
}

export function getStretchedKey(): Uint8Array | null {
  return state.stretchedKey ? new Uint8Array(state.stretchedKey) : null;
}

/** Encrypt item data for a vault. Returns base64 wire blob. */
export async function encryptData(
  vaultId: string,
  plaintext: Uint8Array,
): Promise<string> {
  const key = requireVaultKey(vaultId);
  const blob = await aesGcmEncrypt(key, plaintext);
  return toBase64(serializeBlob(blob));
}

/** Decrypt item data. Returns plaintext bytes. */
export async function decryptData(
  vaultId: string,
  encryptedB64: string,
): Promise<Uint8Array> {
  const key = requireVaultKey(vaultId);
  const blob = parseBlob(fromBase64(encryptedB64));
  return aesGcmDecrypt(key, blob);
}

/** Encrypt an item name with 32-byte padding. Returns base64 wire blob. */
export async function encryptName(
  vaultId: string,
  name: string,
): Promise<string> {
  const key = requireVaultKey(vaultId);
  const padded = pad(new TextEncoder().encode(name));
  const blob = await aesGcmEncrypt(key, padded);
  return toBase64(serializeBlob(blob));
}

/** Decrypt an item name. Returns plain string. */
export async function decryptName(
  vaultId: string,
  encryptedB64: string,
): Promise<string> {
  const key = requireVaultKey(vaultId);
  const blob = parseBlob(fromBase64(encryptedB64));
  const padded = await aesGcmDecrypt(key, blob);
  return new TextDecoder().decode(unpad(padded));
}

/** Zero all key material. Call on lock or background. */
export function lock(): void {
  if (state.stretchedKey) state.stretchedKey.fill(0);
  for (const k of state.vaultKeys.values()) k.fill(0);
  state = { stretchedKey: null, vaultKeys: new Map() };
}
