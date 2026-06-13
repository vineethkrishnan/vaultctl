// SPDX-License-Identifier: AGPL-3.0-or-later

import { IItemRepository } from '../../../domain/vault/ports/IItemRepository';
import { VaultId } from '../../../domain/vault/value-objects/VaultId';
import { ItemSummaryDto } from '../../dtos/ItemDtos';

export interface ListItemsDeps {
  itemRepository: IItemRepository;
}

export class ListItems {
  constructor(private readonly deps: ListItemsDeps) {}

  async execute(vaultId: string, includetrashed = false): Promise<ItemSummaryDto[]> {
    const items = await this.deps.itemRepository.findByVaultId(
      VaultId.of(vaultId),
      includetrashed,
    );
    return items.map((item) => ({
      id: item.id.value,
      vaultId: item.vaultId.value,
      folderId: item.folderId?.value,
      itemType: item.itemType.value,
      encryptedName: item.encryptedName.value,
      isFavorite: item.isFavorite,
      isReprompt: item.isReprompt,
      isTrashed: item.isTrashed,
      updatedAt: item.updatedAt.toISOString(),
    }));
  }
}
