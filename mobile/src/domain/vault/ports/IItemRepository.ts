// SPDX-License-Identifier: AGPL-3.0-or-later

import { VaultItem } from '../entities/VaultItem';
import { ItemId } from '../value-objects/ItemId';
import { VaultId } from '../value-objects/VaultId';

export interface IItemRepository {
  saveAll(items: VaultItem[]): Promise<void>;
  findAll(includetrashed?: boolean): Promise<VaultItem[]>;
  findByVaultId(vaultId: VaultId, includetrashed?: boolean): Promise<VaultItem[]>;
  findById(id: ItemId): Promise<VaultItem | null>;
  findFavorites(): Promise<VaultItem[]>;
  findTrashed(): Promise<VaultItem[]>;
  deleteById(id: ItemId): Promise<void>;
  deleteByVaultId(vaultId: VaultId): Promise<void>;
  deleteAll(): Promise<void>;
}
