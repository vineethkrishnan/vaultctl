// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ItemSummaryDto {
  id: string;
  vaultId: string;
  folderId?: string;
  itemType: string;
  encryptedName: string;
  decryptedName?: string;
  isFavorite: boolean;
  isReprompt: boolean;
  isTrashed: boolean;
  updatedAt: string;
}

export interface ItemDetailDto {
  id: string;
  vaultId: string;
  folderId?: string;
  itemType: string;
  decryptedName: string;
  decryptedData: unknown;
  isFavorite: boolean;
  isReprompt: boolean;
  isTrashed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateItemInput {
  vaultId: string;
  folderId?: string;
  itemType: string;
  name: string;
  data: unknown;
}

export interface UpdateItemInput {
  itemId: string;
  vaultId: string;
  folderId?: string;
  name: string;
  data: unknown;
}

export interface SearchItemsInput {
  query: string;
  vaultId?: string;
}

export interface FolderDto {
  id: string;
  vaultId: string;
  decryptedName: string;
}
