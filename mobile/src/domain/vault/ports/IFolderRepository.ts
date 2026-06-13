// SPDX-License-Identifier: AGPL-3.0-or-later

import { Folder } from '../entities/Folder';
import { FolderId } from '../value-objects/FolderId';
import { VaultId } from '../value-objects/VaultId';

export interface IFolderRepository {
  saveAll(folders: Folder[]): Promise<void>;
  findByVaultId(vaultId: VaultId): Promise<Folder[]>;
  deleteById(id: FolderId): Promise<void>;
  deleteByVaultId(vaultId: VaultId): Promise<void>;
  deleteAll(): Promise<void>;
}
