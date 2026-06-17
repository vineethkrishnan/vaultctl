// SPDX-License-Identifier: AGPL-3.0-or-later

import { IAuthService, SessionInfo } from '../../../domain/auth/ports/IAuthService';

export class GetActiveSessions {
  constructor(private readonly authService: IAuthService) {}

  async execute(): Promise<SessionInfo[]> {
    return this.authService.listSessions();
  }
}
