// SPDX-License-Identifier: AGPL-3.0-or-later

import { IItemRepository } from '../../../domain/vault/ports/IItemRepository';
import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { VaultLockedError } from '../../../domain/vault/errors/VaultErrors';
import { ItemSummaryDto } from '../../dtos/ItemDtos';

export interface ListFavoritesDeps {
  itemRepository: IItemRepository;
  cryptoService: ICryptoService;
}

export class ListFavorites {
  constructor(private readonly deps: ListFavoritesDeps) {}

  async execute(): Promise<ItemSummaryDto[]> {
    const { itemRepository, cryptoService } = this.deps;

    if (!cryptoService.isUnlocked()) throw new VaultLockedError();

    const items = await itemRepository.findFavorites();

    const results = await Promise.all(
      items.map(async (item) => {
        let decryptedName: string | undefined;
        try {
          decryptedName = await cryptoService.decryptItemName(
            item.vaultId.value,
            item.encryptedName,
          );
        } catch {
          decryptedName = undefined;
        }
        const dto: ItemSummaryDto = {
          id: item.id.value,
          vaultId: item.vaultId.value,
          folderId: item.folderId?.value,
          itemType: item.itemType.value,
          encryptedName: item.encryptedName.value,
          decryptedName,
          isFavorite: item.isFavorite,
          isReprompt: item.isReprompt,
          isTrashed: item.isTrashed,
          updatedAt: item.updatedAt.toISOString(),
        };
        return dto;
      }),
    );

    return results;
  }
}
