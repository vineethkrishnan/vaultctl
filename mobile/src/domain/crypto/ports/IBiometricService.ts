// SPDX-License-Identifier: AGPL-3.0-or-later

export interface BiometricUnlockPayload {
  stretchedKey: Uint8Array;
  encryptedPrivateKey: string;
  vaults: Array<{
    vaultId: string;
    vaultType: string;
    encryptedVaultKey: string;
  }>;
}

export interface IBiometricService {
  isAvailable(): Promise<boolean>;
  isEnrolled(): Promise<boolean>;
  enroll(payload: BiometricUnlockPayload): Promise<void>;
  unlock(): Promise<BiometricUnlockPayload>;
  clear(): Promise<void>;
}
