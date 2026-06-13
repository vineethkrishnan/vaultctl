// SPDX-License-Identifier: AGPL-3.0-or-later

import { ISyncEngine } from '../../../domain/sync/ports/ISyncEngine';
import { VaultId } from '../../../domain/vault/value-objects/VaultId';

export interface SyncVaultDeps {
  syncEngine: ISyncEngine;
}

export class SyncVault {
  constructor(private readonly deps: SyncVaultDeps) {}

  async execute(vaultId: string): Promise<void> {
    await this.deps.syncEngine.syncVault(VaultId.of(vaultId));
  }
}
