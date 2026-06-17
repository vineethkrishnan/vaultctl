// SPDX-License-Identifier: AGPL-3.0-or-later

import * as SecureStore from 'expo-secure-store';

const KEY = 'vaultctl_unlock_ctx';

export interface UnlockContext {
  email: string;
  encryptedPrivateKey: string;
  vaults: Array<{ vaultId: string; vaultType: string; encryptedVaultKey: string }>;
}

export class UnlockContextStore {
  async save(ctx: UnlockContext): Promise<void> {
    await SecureStore.setItemAsync(KEY, JSON.stringify(ctx));
  }

  async load(): Promise<UnlockContext | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UnlockContext;
  }

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
  }
}
