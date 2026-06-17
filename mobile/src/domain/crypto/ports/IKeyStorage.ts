// SPDX-License-Identifier: AGPL-3.0-or-later

import { Session } from '../../auth/entities/Session';
import { ServerUrl } from '../../auth/value-objects/ServerUrl';

export interface IKeyStorage {
  saveSession(session: Session): Promise<void>;
  loadSession(): Promise<Session | null>;
  clearSession(): Promise<void>;
  saveServerUrl(url: ServerUrl): Promise<void>;
  loadServerUrl(): Promise<ServerUrl | null>;
}
