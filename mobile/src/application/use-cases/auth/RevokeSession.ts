// SPDX-License-Identifier: AGPL-3.0-or-later

import { IAuthService } from '../../../domain/auth/ports/IAuthService';

export class RevokeSession {
  constructor(private readonly authService: IAuthService) {}

  async execute(sessionId: string): Promise<void> {
    return this.authService.revokeSession(sessionId);
  }
}
