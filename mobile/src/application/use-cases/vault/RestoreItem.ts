// SPDX-License-Identifier: AGPL-3.0-or-later

import { IItemRepository } from '../../../domain/vault/ports/IItemRepository';
import { IVaultApiPort } from '../../../domain/vault/ports/IVaultApiPort';
import { ISyncEngine } from '../../../domain/sync/ports/ISyncEngine';
import { ItemId } from '../../../domain/vault/value-objects/ItemId';
import { VaultItemNotFoundError } from '../../../domain/vault/errors/VaultErrors';

export interface RestoreItemDeps {
  itemRepository: IItemRepository;
  vaultApiPort: IVaultApiPort;
  syncEngine: ISyncEngine;
}

export class RestoreItem {
  constructor(private readonly deps: RestoreItemDeps) {}

  async execute(itemId: string): Promise<void> {
    const { itemRepository, vaultApiPort, syncEngine } = this.deps;

    const item = await itemRepository.findById(ItemId.of(itemId));
    if (!item) throw new VaultItemNotFoundError(itemId);

    await vaultApiPort.restoreItem(itemId);
    await syncEngine.syncVault(item.vaultId);
  }
}
