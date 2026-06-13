// SPDX-License-Identifier: AGPL-3.0-or-later

import { IFolderRepository } from '../../../domain/vault/ports/IFolderRepository';
import { Folder } from '../../../domain/vault/entities/Folder';
import { FolderId } from '../../../domain/vault/value-objects/FolderId';
import { VaultId } from '../../../domain/vault/value-objects/VaultId';
import { EncryptedBlob } from '../../../domain/vault/value-objects/EncryptedBlob';
import { getDatabase } from './DatabaseProvider';

interface FolderRow {
  id: string;
  vault_id: string;
  encrypted_name: string;
  created_at: string;
}

function rowToFolder(row: FolderRow): Folder {
  return Folder.create({
    id: FolderId.of(row.id),
    vaultId: VaultId.of(row.vault_id),
    encryptedName: EncryptedBlob.of(row.encrypted_name),
    createdAt: new Date(row.created_at),
  });
}

export class FolderRepositorySQLite implements IFolderRepository {
  async saveAll(folders: Folder[]): Promise<void> {
    if (folders.length === 0) return;
    const db = getDatabase();
    const now = Date.now();
    await db.withTransactionAsync(async () => {
      for (const f of folders) {
        await db.runAsync(
          `INSERT INTO folders (id, vault_id, encrypted_name, created_at, synced_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             encrypted_name=excluded.encrypted_name, synced_at=excluded.synced_at`,
          [f.id.value, f.vaultId.value, f.encryptedName.value,
           f.createdAt.toISOString(), now],
        );
      }
    });
  }

  async findByVaultId(vaultId: VaultId): Promise<Folder[]> {
    const rows = await getDatabase().getAllAsync<FolderRow>(
      'SELECT * FROM folders WHERE vault_id = ? ORDER BY created_at ASC',
      [vaultId.value],
    );
    return rows.map(rowToFolder);
  }

  async deleteById(id: FolderId): Promise<void> {
    await getDatabase().runAsync('DELETE FROM folders WHERE id = ?', [id.value]);
  }

  async deleteByVaultId(vaultId: VaultId): Promise<void> {
    await getDatabase().runAsync('DELETE FROM folders WHERE vault_id = ?', [vaultId.value]);
  }

  async deleteAll(): Promise<void> {
    await getDatabase().runAsync('DELETE FROM folders');
  }
}
