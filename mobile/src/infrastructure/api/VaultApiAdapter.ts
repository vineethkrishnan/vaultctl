// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  IVaultApiPort,
  RawVaultData,
  RawItemData,
  RawFolderData,
  CreateItemInput,
  UpdateItemInput,
  RawSessionData,
  ChangePasswordInput,
} from '../../domain/vault/ports/IVaultApiPort';
import { HttpClient } from './HttpClient';

export class VaultApiAdapter implements IVaultApiPort {
  constructor(private readonly httpClient: HttpClient) {}

  async fetchVaults(): Promise<RawVaultData[]> {
    const { data } = await this.httpClient.fetch<RawVaultData[]>('/vaults');
    return data;
  }

  async fetchItems(vaultId: string): Promise<RawItemData[]> {
    const { data } = await this.httpClient.fetch<RawItemData[]>(
      `/vaults/${vaultId}/items`,
    );
    return data;
  }

  async fetchFolders(vaultId: string): Promise<RawFolderData[]> {
    const { data } = await this.httpClient.fetch<RawFolderData[]>(
      `/vaults/${vaultId}/folders`,
    );
    return data;
  }

  async createItem(input: CreateItemInput): Promise<RawItemData> {
    const { data } = await this.httpClient.fetch<RawItemData>(
      `/vaults/${input.vaultId}/items`,
      {
        method: 'POST',
        body: JSON.stringify({
          folderId: input.folderId,
          itemType: input.itemType,
          encryptedData: input.encryptedData,
          encryptedName: input.encryptedName,
        }),
      },
    );
    return data;
  }

  async updateItem(itemId: string, input: UpdateItemInput): Promise<RawItemData> {
    const { data } = await this.httpClient.fetch<RawItemData>(`/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return data;
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.httpClient.fetch(`/items/${itemId}`, { method: 'DELETE' });
  }

  async restoreItem(itemId: string): Promise<void> {
    await this.httpClient.fetch(`/items/${itemId}/restore`, { method: 'POST' });
  }

  async toggleFavorite(itemId: string, isFavorite: boolean): Promise<void> {
    await this.httpClient.fetch(`/items/${itemId}/favorite`, {
      method: 'PATCH',
      body: JSON.stringify({ favorite: isFavorite }),
    });
  }

  async fetchSessions(): Promise<RawSessionData[]> {
    const { data } = await this.httpClient.fetch<RawSessionData[]>('/auth/sessions');
    return data;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.httpClient.fetch(`/auth/sessions/${sessionId}`, { method: 'DELETE' });
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    await this.httpClient.fetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
}
