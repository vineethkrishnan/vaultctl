// SPDX-License-Identifier: AGPL-3.0-or-later

import { IItemRepository } from '../../../domain/vault/ports/IItemRepository';
import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { VaultId } from '../../../domain/vault/value-objects/VaultId';
import { VaultLockedError } from '../../../domain/vault/errors/VaultErrors';
import { ItemSummaryDto, SearchItemsInput } from '../../dtos/ItemDtos';

export interface SearchItemsDeps {
  itemRepository: IItemRepository;
  cryptoService: ICryptoService;
}

export class SearchItems {
  constructor(private readonly deps: SearchItemsDeps) {}

  async execute(input: SearchItemsInput): Promise<ItemSummaryDto[]> {
    const { itemRepository, cryptoService } = this.deps;

    if (!cryptoService.isUnlocked()) throw new VaultLockedError();

    const query = input.query.trim().toLowerCase();
    if (!query) return [];

    const items = input.vaultId
      ? await itemRepository.findByVaultId(VaultId.of(input.vaultId))
      : await itemRepository.findAll();

    const results = await Promise.all(
      items.map(async (item) => {
        try {
          const name = await cryptoService.decryptItemName(
            item.vaultId.value,
            item.encryptedName,
          );
          if (!name.toLowerCase().includes(query)) return null;
          const result: ItemSummaryDto = {
            id: item.id.value,
            vaultId: item.vaultId.value,
            folderId: item.folderId?.value,
            itemType: item.itemType.value,
            encryptedName: item.encryptedName.value,
            decryptedName: name,
            isFavorite: item.isFavorite,
            isReprompt: item.isReprompt,
            isTrashed: item.isTrashed,
            updatedAt: item.updatedAt.toISOString(),
          };
          return result;
        } catch {
          return null;
        }
      }),
    );

    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  }
}
