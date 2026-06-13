// SPDX-License-Identifier: AGPL-3.0-or-later

import { IItemRepository } from '../../../domain/vault/ports/IItemRepository';
import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { ItemId } from '../../../domain/vault/value-objects/ItemId';
import { VaultItemNotFoundError, VaultLockedError } from '../../../domain/vault/errors/VaultErrors';
import { ItemDetailDto } from '../../dtos/ItemDtos';

export interface DecryptItemDeps {
  itemRepository: IItemRepository;
  cryptoService: ICryptoService;
}

export class DecryptItem {
  constructor(private readonly deps: DecryptItemDeps) {}

  async execute(itemId: string): Promise<ItemDetailDto> {
    const { itemRepository, cryptoService } = this.deps;

    if (!cryptoService.isUnlocked()) throw new VaultLockedError();

    const item = await itemRepository.findById(ItemId.of(itemId));
    if (!item) throw new VaultItemNotFoundError(itemId);

    const [decryptedName, plaintextBytes] = await Promise.all([
      cryptoService.decryptItemName(item.vaultId.value, item.encryptedName),
      cryptoService.decryptItemData(item.vaultId.value, item.encryptedData),
    ]);

    const decryptedData = JSON.parse(new TextDecoder().decode(plaintextBytes)) as unknown;

    return {
      id: item.id.value,
      vaultId: item.vaultId.value,
      folderId: item.folderId?.value,
      itemType: item.itemType.value,
      decryptedName,
      decryptedData,
      isFavorite: item.isFavorite,
      isReprompt: item.isReprompt,
      isTrashed: item.isTrashed,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
