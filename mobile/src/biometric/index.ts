// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Biometric unlock: enrolls a wrapped copy of the vault unlock material in
 * expo-secure-store with biometric access requirement (Keychain/Keystore).
 *
 * The stored blob is the JSON-serialized unlock params (stretchedKey,
 * encryptedPrivateKey, vault membership list) encrypted with a random AES-GCM
 * key, where that key is itself stored in a separate Keychain/Keystore slot
 * that requires biometric authentication to read.
 *
 * Simpler approach used here: store the unlock JSON directly under a
 * BIOMETRIC_ACCESSIBLE SecureStore key. This leverages the OS-level
 * hardware-backed requirement without a second key layer.
 */

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import type { InitParams } from '../store/keys';

const BIOMETRIC_SLOT = 'vaultctl_biometric_unlock';

export interface BiometricEnrollParams {
  stretchedKey: Uint8Array;
  encryptedPrivateKey: string;
  vaults: InitParams['vaults'];
}

function encodeParams(p: BiometricEnrollParams): string {
  return JSON.stringify({
    stretchedKey: Array.from(p.stretchedKey),
    encryptedPrivateKey: p.encryptedPrivateKey,
    vaults: p.vaults,
  });
}

function decodeParams(raw: string): BiometricEnrollParams {
  const obj = JSON.parse(raw) as {
    stretchedKey: number[];
    encryptedPrivateKey: string;
    vaults: InitParams['vaults'];
  };
  return {
    stretchedKey: new Uint8Array(obj.stretchedKey),
    encryptedPrivateKey: obj.encryptedPrivateKey,
    vaults: obj.vaults,
  };
}

export async function isBiometricAvailable(): Promise<boolean> {
  const supported = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return supported && enrolled;
}

export async function isBiometricEnrolled(): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(BIOMETRIC_SLOT, {
      requireAuthentication: false,
    });
    return raw !== null;
  } catch {
    return false;
  }
}

/** Enroll biometric after a successful master-password login. */
export async function enrollBiometric(params: BiometricEnrollParams): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_SLOT, encodeParams(params), {
    requireAuthentication: true,
    authenticationPrompt: 'Authenticate to enable biometric unlock',
  });
}

/**
 * Prompt biometrics and return unlock params.
 * Throws if the user cancels or biometrics fail.
 */
export async function unlockWithBiometrics(): Promise<BiometricEnrollParams> {
  const raw = await SecureStore.getItemAsync(BIOMETRIC_SLOT, {
    requireAuthentication: true,
    authenticationPrompt: 'Unlock your vault',
  });

  if (!raw) throw new Error('BIOMETRIC_NOT_ENROLLED');
  return decodeParams(raw);
}

/** Remove biometric enrollment. Called on logout or when user disables it. */
export async function clearBiometricEnrollment(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(BIOMETRIC_SLOT);
  } catch {
    // Key may not exist; ignore.
  }
}

export async function promptBiometrics(reason: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    fallbackLabel: 'Use Master Password',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return result.success;
}
