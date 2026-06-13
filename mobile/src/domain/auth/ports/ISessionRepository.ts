// SPDX-License-Identifier: AGPL-3.0-or-later

import { Session } from '../entities/Session';

export interface ISessionRepository {
  save(session: Session): Promise<void>;
  load(): Promise<Session | null>;
  clear(): Promise<void>;
}
