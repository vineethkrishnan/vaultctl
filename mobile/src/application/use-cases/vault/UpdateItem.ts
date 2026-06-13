// SPDX-License-Identifier: AGPL-3.0-or-later

import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { IItemRepository } from '../../../domain/vault/ports/IItemRepository';
import { IVaultRepository } from '../../../domain/vault/ports/IVaultRepository';
import { IVaultApiPort } from '../../../domain/vault/ports/IVaultApiPort';
import { ISyncEngine } from '../../../domain/sync/ports/ISyncEngine';
import { ItemId } from '../../../domain/vault/value-objects/ItemId';
import { VaultId } from '../../../domain/vault/value-objects/VaultId';
import {
  VaultLockedError,
  VaultItemNotFoundError,
  VaultNotFoundError,
  VaultWriteNotAllowedError,
} from '../../../domain/vault/errors/VaultErrors';
import { UpdateItemInput } from '../../dtos/ItemDtos';

export interface UpdateItemDeps {
  cryptoService: ICryptoService;
  itemRepository: IItemRepository;
  vaultRepository: IVaultRepository;
  vaultApiPort: IVaultApiPort;
  syncEngine: ISyncEngine;
}

export class UpdateItem {
  constructor(private readonly deps: UpdateItemDeps) {}

  async execute(input: UpdateItemInput): Promise<void> {
    const { cryptoService, itemRepository, vaultRepository, vaultApiPort, syncEngine } = this.deps;

    if (!cryptoService.isUnlocked()) throw new VaultLockedError();

    const item = await itemRepository.findById(ItemId.of(input.itemId));
    if (!item) throw new VaultItemNotFoundError(input.itemId);

    const vault = await vaultRepository.findById(VaultId.of(input.vaultId));
    if (!vault) throw new VaultNotFoundError(input.vaultId);
    if (!vault.canWrite) throw new VaultWriteNotAllowedError(input.vaultId);

    const plaintext = new TextEncoder().encode(JSON.stringify(input.data));
    const [encryptedData, encryptedName] = await Promise.all([
      cryptoService.encryptItemData(input.vaultId, plaintext),
      cryptoService.encryptItemName(input.vaultId, input.name),
    ]);

    await vaultApiPort.updateItem(input.itemId, {
      folderId: input.folderId,
      encryptedData: encryptedData.value,
      encryptedName: encryptedName.value,
    });

    await syncEngine.syncVault(VaultId.of(input.vaultId));
  }
}
