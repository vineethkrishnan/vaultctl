// SPDX-License-Identifier: AGPL-3.0-or-later

import { ServerUrl } from '../value-objects/ServerUrl';

export interface IServerConfigRepository {
  save(url: ServerUrl): Promise<void>;
  load(): Promise<ServerUrl | null>;
  clear(): Promise<void>;
}
