// SPDX-License-Identifier: AGPL-3.0-or-later

import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { IBiometricService } from '../../../domain/crypto/ports/IBiometricService';
import { BiometricNotEnrolledError } from '../../../domain/auth/errors/AuthErrors';

export interface UnlockWithBiometricDeps {
  cryptoService: ICryptoService;
  biometricService: IBiometricService;
}

export class UnlockWithBiometric {
  constructor(private readonly deps: UnlockWithBiometricDeps) {}

  async execute(): Promise<void> {
    const { cryptoService, biometricService } = this.deps;

    const isEnrolled = await biometricService.isEnrolled();
    if (!isEnrolled) {
      throw new BiometricNotEnrolledError();
    }

    const payload = await biometricService.unlock();

    await cryptoService.initKeys({
      stretchedKey: payload.stretchedKey,
      encryptedPrivateKey: payload.encryptedPrivateKey,
      vaults: payload.vaults,
    });
  }
}
