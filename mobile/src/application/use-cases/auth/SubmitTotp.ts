// SPDX-License-Identifier: AGPL-3.0-or-later

import { IAuthService } from '../../../domain/auth/ports/IAuthService';
import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { ISessionRepository } from '../../../domain/auth/ports/ISessionRepository';
import { Session } from '../../../domain/auth/entities/Session';
import { UserId } from '../../../domain/auth/value-objects/UserId';
import { SubmitTotpInput } from '../../dtos/AuthDtos';

export interface SubmitTotpDeps {
  authService: IAuthService;
  cryptoService: ICryptoService;
  sessionRepository: ISessionRepository;
  pendingStretchedKey: Uint8Array;
  pendingEncryptedPrivateKey: string;
  pendingVaults: Array<{ vaultId: string; vaultType: string; encryptedVaultKey: string }>;
}

export class SubmitTotp {
  constructor(private readonly deps: SubmitTotpDeps) {}

  async execute(input: SubmitTotpInput): Promise<void> {
    const { authService, cryptoService, sessionRepository } = this.deps;

    const result = await authService.submitTotp({
      email: input.email,
      code: input.code.trim(),
    });

    const session = Session.create({
      userId: UserId.of(result.userId),
      role: result.role,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      sessionId: result.sessionId,
    });

    await cryptoService.initKeys({
      stretchedKey: this.deps.pendingStretchedKey,
      encryptedPrivateKey: result.encryptedPrivateKey,
      vaults: result.vaults,
    });

    await sessionRepository.save(session);
  }
}
