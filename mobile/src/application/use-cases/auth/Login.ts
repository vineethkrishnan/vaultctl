// SPDX-License-Identifier: AGPL-3.0-or-later

import { IAuthService } from '../../../domain/auth/ports/IAuthService';
import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { ISessionRepository } from '../../../domain/auth/ports/ISessionRepository';
import { Session } from '../../../domain/auth/entities/Session';
import { UserId } from '../../../domain/auth/value-objects/UserId';
import { TotpRequiredError } from '../../../domain/auth/errors/AuthErrors';
import { LoginInput, LoginOutput } from '../../dtos/AuthDtos';

export interface LoginDeps {
  authService: IAuthService;
  cryptoService: ICryptoService;
  sessionRepository: ISessionRepository;
}

export class Login {
  constructor(private readonly deps: LoginDeps) {}

  async execute(input: LoginInput): Promise<LoginOutput> {
    const { authService, cryptoService, sessionRepository } = this.deps;
    const email = input.email.trim().toLowerCase();

    const prelogin = await authService.prelogin(email);
    const derived = await cryptoService.deriveKeys(input.password, prelogin.salt, prelogin.kdfParams);

    const result = await authService.login({
      email,
      authHash: cryptoService.toBase64(derived.authHash),
    });

    if (result.kind === 'totp_required') {
      throw new TotpRequiredError(email);
    }

    const session = Session.create({
      userId: UserId.of(result.userId),
      role: result.role,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      sessionId: result.sessionId,
    });

    await cryptoService.initKeys({
      stretchedKey: derived.stretchedKey,
      encryptedPrivateKey: result.encryptedPrivateKey,
      vaults: result.vaults,
    });

    await sessionRepository.save(session);

    return { requiresTOTP: false };
  }
}
