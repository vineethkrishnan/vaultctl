// SPDX-License-Identifier: AGPL-3.0-or-later

export interface RawVaultData {
  id: string;
  name: string;
  type: string;
  orgId?: string;
  role: string;
  encryptedVaultKey: string;
  senderId: string;
  wrapSignature: string;
  createdAt: string;
}

export interface RawItemData {
  id: string;
  vaultId: string;
  folderId?: string;
  itemType: string;
  encryptedData: string;
  encryptedName: string;
  favorite: boolean;
  reprompt: boolean;
  trashed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RawFolderData {
  id: string;
  vaultId: string;
  encryptedName: string;
  createdAt: string;
}

export interface CreateItemInput {
  vaultId: string;
  folderId?: string;
  itemType: string;
  encryptedData: string;
  encryptedName: string;
}

export interface UpdateItemInput {
  folderId?: string;
  encryptedData: string;
  encryptedName: string;
}

export interface RawSessionData {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  isCurrent: boolean;
}

export interface ChangePasswordInput {
  currentAuthHash: string;
  newAuthHash: string;
  newEncryptedPrivateKey: string;
  newKDFParams: {
    iterations: number;
    memoryKB: number;
    parallelism: number;
  };
}

export interface IVaultApiPort {
  fetchVaults(): Promise<RawVaultData[]>;
  fetchItems(vaultId: string): Promise<RawItemData[]>;
  fetchFolders(vaultId: string): Promise<RawFolderData[]>;
  createItem(input: CreateItemInput): Promise<RawItemData>;
  updateItem(itemId: string, input: UpdateItemInput): Promise<RawItemData>;
  deleteItem(itemId: string): Promise<void>;
  restoreItem(itemId: string): Promise<void>;
  toggleFavorite(itemId: string, isFavorite: boolean): Promise<void>;
  fetchSessions(): Promise<RawSessionData[]>;
  revokeSession(sessionId: string): Promise<void>;
  changePassword(input: ChangePasswordInput): Promise<void>;
}
