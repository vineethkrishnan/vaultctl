// SPDX-License-Identifier: AGPL-3.0-or-later

import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { IBiometricService } from '../../../domain/crypto/ports/IBiometricService';
import {
  BiometricNotAvailableError,
  BiometricNotEnrolledError,
} from '../../../domain/auth/errors/AuthErrors';
import { VaultLockedError } from '../../../domain/vault/errors/VaultErrors';

export interface EnableBiometricUnlockDeps {
  cryptoService: ICryptoService;
  biometricService: IBiometricService;
  encryptedPrivateKey: string;
  vaults: Array<{ vaultId: string; vaultType: string; encryptedVaultKey: string }>;
  stretchedKey: Uint8Array;
}

export class EnableBiometricUnlock {
  constructor(private readonly deps: EnableBiometricUnlockDeps) {}

  async execute(): Promise<void> {
    const { cryptoService, biometricService } = this.deps;

    if (!cryptoService.isUnlocked()) throw new VaultLockedError();

    const isAvailable = await biometricService.isAvailable();
    if (!isAvailable) throw new BiometricNotAvailableError();

    await biometricService.enroll({
      stretchedKey: this.deps.stretchedKey,
      encryptedPrivateKey: this.deps.encryptedPrivateKey,
      vaults: this.deps.vaults,
    });
  }
}

export class DisableBiometricUnlock {
  constructor(
    private readonly biometricService: IBiometricService,
  ) {}

  async execute(): Promise<void> {
    const isEnrolled = await this.biometricService.isEnrolled();
    if (!isEnrolled) throw new BiometricNotEnrolledError();
    await this.biometricService.clear();
  }
}
