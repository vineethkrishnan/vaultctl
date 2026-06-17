// SPDX-License-Identifier: AGPL-3.0-or-later

import { IAuthService } from '../../../domain/auth/ports/IAuthService';
import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { IBiometricService } from '../../../domain/crypto/ports/IBiometricService';
import { ISessionRepository } from '../../../domain/auth/ports/ISessionRepository';
import { IVaultRepository } from '../../../domain/vault/ports/IVaultRepository';
import { IItemRepository } from '../../../domain/vault/ports/IItemRepository';
import { IFolderRepository } from '../../../domain/vault/ports/IFolderRepository';

export interface LogoutSessionDeps {
  authService: IAuthService;
  cryptoService: ICryptoService;
  biometricService: IBiometricService;
  sessionRepository: ISessionRepository;
  vaultRepository: IVaultRepository;
  itemRepository: IItemRepository;
  folderRepository: IFolderRepository;
}

export class LogoutSession {
  constructor(private readonly deps: LogoutSessionDeps) {}

  async execute(): Promise<void> {
    const { authService, cryptoService, biometricService, sessionRepository,
      vaultRepository, itemRepository, folderRepository } = this.deps;

    cryptoService.lock();
    await biometricService.clear().catch(() => {});
    await authService.logout().catch(() => {});
    await sessionRepository.clear();
    await itemRepository.deleteAll();
    await folderRepository.deleteAll();
    await vaultRepository.deleteAll();
  }
}
