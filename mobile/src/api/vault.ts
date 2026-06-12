// SPDX-License-Identifier: AGPL-3.0-or-later

import { apiFetch } from './client';
import type {
  VaultResponse,
  ItemResponse,
  FolderResponse,
} from '@vaultctl/shared/types/api';

export async function fetchVaults(): Promise<VaultResponse[]> {
  const { data, status } = await apiFetch<VaultResponse[]>('/vaults');
  if (status !== 200) throw new Error('Failed to fetch vaults');
  return data;
}

export async function fetchItems(vaultId: string): Promise<ItemResponse[]> {
  const { data, status } = await apiFetch<ItemResponse[]>(
    `/vaults/${vaultId}/items`,
  );
  if (status !== 200) throw new Error(`Failed to fetch items for vault ${vaultId}`);
  return data;
}

export async function fetchFolders(vaultId: string): Promise<FolderResponse[]> {
  const { data, status } = await apiFetch<FolderResponse[]>(
    `/vaults/${vaultId}/folders`,
  );
  if (status !== 200) throw new Error('Failed to fetch folders');
  return data;
}

export interface CreateItemRequest {
  folderId?: string;
  itemType: string;
  encryptedData: string;
  encryptedName: string;
  favorite?: boolean;
  reprompt?: boolean;
}

export async function createItem(
  vaultId: string,
  body: CreateItemRequest,
): Promise<ItemResponse> {
  const { data, status } = await apiFetch<ItemResponse>(
    `/vaults/${vaultId}/items`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (status !== 201) throw new Error('Failed to create item');
  return data;
}

export async function updateItem(
  vaultId: string,
  itemId: string,
  body: Partial<CreateItemRequest>,
): Promise<ItemResponse> {
  const { data, status } = await apiFetch<ItemResponse>(
    `/vaults/${vaultId}/items/${itemId}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );
  if (status !== 200) throw new Error('Failed to update item');
  return data;
}

export async function trashItem(
  vaultId: string,
  itemId: string,
): Promise<void> {
  await apiFetch(`/vaults/${vaultId}/items/${itemId}/trash`, {
    method: 'POST',
  });
}
