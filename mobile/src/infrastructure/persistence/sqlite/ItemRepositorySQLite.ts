// SPDX-License-Identifier: AGPL-3.0-or-later

import { IItemRepository } from '../../../domain/vault/ports/IItemRepository';
import { VaultItem } from '../../../domain/vault/entities/VaultItem';
import { ItemId } from '../../../domain/vault/value-objects/ItemId';
import { VaultId } from '../../../domain/vault/value-objects/VaultId';
import { FolderId } from '../../../domain/vault/value-objects/FolderId';
import { ItemType } from '../../../domain/vault/value-objects/ItemType';
import { EncryptedBlob } from '../../../domain/vault/value-objects/EncryptedBlob';
import { getDatabase } from './DatabaseProvider';

interface ItemRow {
  id: string;
  vault_id: string;
  folder_id: string | null;
  item_type: string;
  encrypted_data: string;
  encrypted_name: string;
  favorite: number;
  reprompt: number;
  trashed: number;
  created_at: string;
  updated_at: string;
}

function rowToItem(row: ItemRow): VaultItem {
  return VaultItem.create({
    id: ItemId.of(row.id),
    vaultId: VaultId.of(row.vault_id),
    folderId: row.folder_id ? FolderId.of(row.folder_id) : undefined,
    itemType: ItemType.of(row.item_type),
    encryptedData: EncryptedBlob.of(row.encrypted_data),
    encryptedName: EncryptedBlob.of(row.encrypted_name),
    isFavorite: row.favorite === 1,
    isReprompt: row.reprompt === 1,
    isTrashed: row.trashed === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

export class ItemRepositorySQLite implements IItemRepository {
  async saveAll(items: VaultItem[]): Promise<void> {
    if (items.length === 0) return;
    const db = getDatabase();
    const now = Date.now();
    await db.withTransactionAsync(async () => {
      for (const item of items) {
        await db.runAsync(
          `INSERT INTO items (id, vault_id, folder_id, item_type, encrypted_data, encrypted_name,
             favorite, reprompt, trashed, created_at, updated_at, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             folder_id=excluded.folder_id, encrypted_data=excluded.encrypted_data,
             encrypted_name=excluded.encrypted_name, favorite=excluded.favorite,
             reprompt=excluded.reprompt, trashed=excluded.trashed,
             updated_at=excluded.updated_at, synced_at=excluded.synced_at`,
          [item.id.value, item.vaultId.value, item.folderId?.value ?? null,
           item.itemType.value, item.encryptedData.value, item.encryptedName.value,
           item.isFavorite ? 1 : 0, item.isReprompt ? 1 : 0, item.isTrashed ? 1 : 0,
           item.createdAt.toISOString(), item.updatedAt.toISOString(), now],
        );
      }
    });
  }

  async findAll(includetrashed = false): Promise<VaultItem[]> {
    const rows = await getDatabase().getAllAsync<ItemRow>(
      'SELECT * FROM items WHERE trashed = ? ORDER BY updated_at DESC',
      [includetrashed ? 1 : 0],
    );
    return rows.map(rowToItem);
  }

  async findByVaultId(vaultId: VaultId, includetrashed = false): Promise<VaultItem[]> {
    const rows = await getDatabase().getAllAsync<ItemRow>(
      'SELECT * FROM items WHERE vault_id = ? AND trashed = ? ORDER BY updated_at DESC',
      [vaultId.value, includetrashed ? 1 : 0],
    );
    return rows.map(rowToItem);
  }

  async findById(id: ItemId): Promise<VaultItem | null> {
    const row = await getDatabase().getFirstAsync<ItemRow>(
      'SELECT * FROM items WHERE id = ?',
      [id.value],
    );
    return row ? rowToItem(row) : null;
  }

  async findFavorites(): Promise<VaultItem[]> {
    const rows = await getDatabase().getAllAsync<ItemRow>(
      'SELECT * FROM items WHERE favorite = 1 AND trashed = 0 ORDER BY updated_at DESC',
    );
    return rows.map(rowToItem);
  }

  async findTrashed(): Promise<VaultItem[]> {
    const rows = await getDatabase().getAllAsync<ItemRow>(
      'SELECT * FROM items WHERE trashed = 1 ORDER BY updated_at DESC',
    );
    return rows.map(rowToItem);
  }

  async deleteById(id: ItemId): Promise<void> {
    await getDatabase().runAsync('DELETE FROM items WHERE id = ?', [id.value]);
  }

  async deleteByVaultId(vaultId: VaultId): Promise<void> {
    await getDatabase().runAsync('DELETE FROM items WHERE vault_id = ?', [vaultId.value]);
  }

  async deleteAll(): Promise<void> {
    await getDatabase().runAsync('DELETE FROM items');
  }
}
