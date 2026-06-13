// SPDX-License-Identifier: AGPL-3.0-or-later

import { VaultId } from '../../vault/value-objects/VaultId';

export interface SyncResult {
  vaultCount: number;
  itemCount: number;
}

export interface ISyncEngine {
  syncAll(): Promise<SyncResult>;
  syncVault(vaultId: VaultId): Promise<void>;
  isCacheValid(vaultId: VaultId): Promise<boolean>;
  openDatabase(): Promise<void>;
}
