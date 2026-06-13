// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { container } from '../../container';
import { ItemSummaryDto } from '../../application/dtos/ItemDtos';

const TRASH_KEY = ['trash'] as const;

export function useTrash() {
  const queryClient = useQueryClient();

  const query = useQuery<ItemSummaryDto[]>({
    queryKey: TRASH_KEY,
    queryFn: () => container.listTrashed.execute(),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: TRASH_KEY });
  }

  return { ...query, invalidate };
}
