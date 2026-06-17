// SPDX-License-Identifier: AGPL-3.0-or-later

import { IBiometricService, BiometricUnlockPayload } from '../../domain/crypto/ports/IBiometricService';
import {
  isBiometricAvailable,
  isBiometricEnrolled,
  enrollBiometric,
  unlockWithBiometrics,
  clearBiometricEnrollment,
} from '../_legacy/biometric/index';

export class BiometricServiceExpo implements IBiometricService {
  async isAvailable(): Promise<boolean> {
    return isBiometricAvailable();
  }

  async isEnrolled(): Promise<boolean> {
    return isBiometricEnrolled();
  }

  async enroll(payload: BiometricUnlockPayload): Promise<void> {
    await enrollBiometric({
      stretchedKey: payload.stretchedKey,
      encryptedPrivateKey: payload.encryptedPrivateKey,
      vaults: payload.vaults.map((v) => ({
        vaultId: v.vaultId,
        vaultType: v.vaultType as 'personal' | 'shared',
        encryptedVaultKey: v.encryptedVaultKey,
      })),
    });
  }

  async unlock(): Promise<BiometricUnlockPayload> {
    const raw = await unlockWithBiometrics();
    return {
      stretchedKey: raw.stretchedKey,
      encryptedPrivateKey: raw.encryptedPrivateKey,
      vaults: raw.vaults,
    };
  }

  async clear(): Promise<void> {
    await clearBiometricEnrollment();
  }
}
