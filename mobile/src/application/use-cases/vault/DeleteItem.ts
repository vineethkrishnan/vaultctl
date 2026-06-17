// SPDX-License-Identifier: AGPL-3.0-or-later

import { IItemRepository } from '../../../domain/vault/ports/IItemRepository';
import { IVaultRepository } from '../../../domain/vault/ports/IVaultRepository';
import { IVaultApiPort } from '../../../domain/vault/ports/IVaultApiPort';
import { ISyncEngine } from '../../../domain/sync/ports/ISyncEngine';
import { ItemId } from '../../../domain/vault/value-objects/ItemId';
import { VaultId } from '../../../domain/vault/value-objects/VaultId';
import {
  VaultItemNotFoundError,
  VaultNotFoundError,
  VaultWriteNotAllowedError,
} from '../../../domain/vault/errors/VaultErrors';

export interface DeleteItemDeps {
  itemRepository: IItemRepository;
  vaultRepository: IVaultRepository;
  vaultApiPort: IVaultApiPort;
  syncEngine: ISyncEngine;
}

export class DeleteItem {
  constructor(private readonly deps: DeleteItemDeps) {}

  async execute(itemId: string): Promise<void> {
    const { itemRepository, vaultRepository, vaultApiPort, syncEngine } = this.deps;

    const item = await itemRepository.findById(ItemId.of(itemId));
    if (!item) throw new VaultItemNotFoundError(itemId);

    const vault = await vaultRepository.findById(item.vaultId);
    if (!vault) throw new VaultNotFoundError(item.vaultId.value);
    if (!vault.canWrite) throw new VaultWriteNotAllowedError(item.vaultId.value);

    await vaultApiPort.deleteItem(itemId);
    await syncEngine.syncVault(item.vaultId);
  }
}
