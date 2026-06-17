// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { container } from '../../container';
import { ItemSummaryDto } from '../../application/dtos/ItemDtos';

const itemsKey = (vaultId: string) => ['items', vaultId] as const;

export function useItems(vaultId: string) {
  const queryClient = useQueryClient();

  const query = useQuery<ItemSummaryDto[]>({
    queryKey: itemsKey(vaultId),
    queryFn: async () => {
      const items = await container.listItems.execute(vaultId);
      const withNames = await Promise.all(
        items.map(async (item) => {
          try {
            const decryptedName = await container.decryptItemName.execute(
              vaultId,
              item.encryptedName,
            );
            return { ...item, decryptedName };
          } catch {
            return { ...item, decryptedName: '(encrypted)' };
          }
        }),
      );
      return withNames;
    },
    enabled: !!vaultId,
  });

  async function syncAndRefresh(): Promise<void> {
    await container.syncVault.execute(vaultId);
    await queryClient.invalidateQueries({ queryKey: itemsKey(vaultId) });
  }

  return { ...query, syncAndRefresh };
}

export function useItemDetail(itemId: string) {
  return useQuery({
    queryKey: ['item', itemId] as const,
    queryFn: () => container.decryptItem.execute(itemId),
    enabled: !!itemId,
  });
}

export function useInvalidateItems() {
  const queryClient = useQueryClient();
  return (vaultId: string) =>
    queryClient.invalidateQueries({ queryKey: itemsKey(vaultId) });
}
