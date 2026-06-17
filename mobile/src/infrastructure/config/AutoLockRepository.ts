// SPDX-License-Identifier: AGPL-3.0-or-later

import * as SecureStore from 'expo-secure-store';

const KEY = 'vaultctl_autolock_minutes';

export type AutoLockMinutes = 0 | 1 | 5 | 15;

export class AutoLockRepository {
  async load(): Promise<AutoLockMinutes> {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = parseInt(raw ?? '5', 10);
    return (([0, 1, 5, 15] as AutoLockMinutes[]).includes(parsed as AutoLockMinutes)
      ? parsed
      : 5) as AutoLockMinutes;
  }

  async save(minutes: AutoLockMinutes): Promise<void> {
    await SecureStore.setItemAsync(KEY, String(minutes));
  }
}
