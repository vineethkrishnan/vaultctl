// SPDX-License-Identifier: AGPL-3.0-or-later

import * as SecureStore from 'expo-secure-store';
import { IServerConfigRepository } from '../../domain/auth/ports/IServerConfigRepository';
import { ServerUrl } from '../../domain/auth/value-objects/ServerUrl';

const KEY = 'vaultctl_server_url';

export class ServerConfigRepository implements IServerConfigRepository {
  async save(url: ServerUrl): Promise<void> {
    await SecureStore.setItemAsync(KEY, url.value);
  }

  async load(): Promise<ServerUrl | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    try {
      return ServerUrl.of(raw);
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
  }
}
