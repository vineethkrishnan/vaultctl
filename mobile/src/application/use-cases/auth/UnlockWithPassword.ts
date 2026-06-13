// SPDX-License-Identifier: AGPL-3.0-or-later

import { IAuthService } from '../../../domain/auth/ports/IAuthService';
import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { ISessionRepository } from '../../../domain/auth/ports/ISessionRepository';
import { VaultLockedError } from '../../../domain/vault/errors/VaultErrors';
import { UnlockWithPasswordInput } from '../../dtos/AuthDtos';

export interface UnlockWithPasswordDeps {
  authService: IAuthService;
  cryptoService: ICryptoService;
  sessionRepository: ISessionRepository;
  currentEmail: string;
  encryptedPrivateKey: string;
  vaults: Array<{ vaultId: string; vaultType: string; encryptedVaultKey: string }>;
}

export class UnlockWithPassword {
  constructor(private readonly deps: UnlockWithPasswordDeps) {}

  async execute(input: UnlockWithPasswordInput): Promise<void> {
    const { authService, cryptoService } = this.deps;

    const prelogin = await authService.prelogin(this.deps.currentEmail);
    const derived = await cryptoService.deriveKeys(
      input.password,
      prelogin.salt,
      prelogin.kdfParams,
    );

    await cryptoService.initKeys({
      stretchedKey: derived.stretchedKey,
      encryptedPrivateKey: this.deps.encryptedPrivateKey,
      vaults: this.deps.vaults,
    });

    if (!cryptoService.isUnlocked()) {
      throw new VaultLockedError();
    }
  }
}
