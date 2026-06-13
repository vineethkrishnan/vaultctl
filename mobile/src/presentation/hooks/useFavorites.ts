// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { container } from '../../container';
import { ItemSummaryDto } from '../../application/dtos/ItemDtos';

const FAVORITES_KEY = ['favorites'] as const;

export function useFavorites() {
  const queryClient = useQueryClient();

  const query = useQuery<ItemSummaryDto[]>({
    queryKey: FAVORITES_KEY,
    queryFn: () => container.listFavorites.execute(),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: FAVORITES_KEY });
  }

  return { ...query, invalidate };
}
