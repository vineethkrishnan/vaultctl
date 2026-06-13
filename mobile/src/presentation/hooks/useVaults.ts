// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { container } from '../../container';
import { VaultDto } from '../../application/dtos/VaultDtos';

const VAULTS_KEY = ['vaults'] as const;

export function useVaults() {
  const queryClient = useQueryClient();

  const query = useQuery<VaultDto[]>({
    queryKey: VAULTS_KEY,
    queryFn: () => container.listVaults.execute(),
  });

  async function syncAndRefresh(): Promise<void> {
    await container.syncAll.execute();
    await queryClient.invalidateQueries({ queryKey: VAULTS_KEY });
  }

  return { ...query, syncAndRefresh };
}
