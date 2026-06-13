// SPDX-License-Identifier: AGPL-3.0-or-later

import { IItemRepository } from '../../../domain/vault/ports/IItemRepository';
import { ItemId } from '../../../domain/vault/value-objects/ItemId';
import { VaultItemNotFoundError } from '../../../domain/vault/errors/VaultErrors';
import { ItemSummaryDto } from '../../dtos/ItemDtos';

export interface GetItemDeps {
  itemRepository: IItemRepository;
}

export class GetItem {
  constructor(private readonly deps: GetItemDeps) {}

  async execute(itemId: string): Promise<ItemSummaryDto> {
    const item = await this.deps.itemRepository.findById(ItemId.of(itemId));
    if (!item) throw new VaultItemNotFoundError(itemId);

    return {
      id: item.id.value,
      vaultId: item.vaultId.value,
      folderId: item.folderId?.value,
      itemType: item.itemType.value,
      encryptedName: item.encryptedName.value,
      isFavorite: item.isFavorite,
      isReprompt: item.isReprompt,
      isTrashed: item.isTrashed,
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
