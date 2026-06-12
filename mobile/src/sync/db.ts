// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SQLite cache for encrypted vault data.
 *
 * We store the server's encrypted blobs verbatim - no decryption happens here.
 * The only thing written to disk is data that the server already holds.
 * Decryption is on-demand, in memory, after the user unlocks.
 */

import * as SQLite from 'expo-sqlite';
import type { VaultResponse, ItemResponse, FolderResponse } from '@vaultctl/shared/types/api';

let db: SQLite.SQLiteDatabase | null = null;

export async function openDb(): Promise<void> {
  if (db) return;
  db = await SQLite.openDatabaseAsync('vaultctl.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS vaults (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      org_id TEXT,
      role TEXT NOT NULL,
      encrypted_vault_key TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      wrap_signature TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
      folder_id TEXT,
      item_type TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      encrypted_name TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      reprompt INTEGER NOT NULL DEFAULT 0,
      trashed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_items_vault_id ON items(vault_id);
    CREATE INDEX IF NOT EXISTS idx_items_trashed ON items(vault_id, trashed);

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
      encrypted_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      vault_id TEXT PRIMARY KEY,
      last_synced_at INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function getDb(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('Database not initialized - call openDb() first');
  return db;
}

const NOW = (): number => Date.now();

export async function upsertVaults(vaults: VaultResponse[]): Promise<void> {
  const d = getDb();
  const now = NOW();
  await d.withTransactionAsync(async () => {
    for (const v of vaults) {
      await d.runAsync(
        `INSERT INTO vaults (id, name, type, org_id, role, encrypted_vault_key, sender_id, wrap_signature, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, type=excluded.type, role=excluded.role,
           encrypted_vault_key=excluded.encrypted_vault_key,
           sender_id=excluded.sender_id, wrap_signature=excluded.wrap_signature,
           synced_at=excluded.synced_at`,
        [v.id, v.name, v.type, v.orgId ?? null, v.role,
         v.encryptedVaultKey, v.senderId, v.wrapSignature, v.createdAt, now],
      );
    }
  });
}

export async function upsertItems(items: ItemResponse[]): Promise<void> {
  if (items.length === 0) return;
  const d = getDb();
  const now = NOW();
  await d.withTransactionAsync(async () => {
    for (const item of items) {
      await d.runAsync(
        `INSERT INTO items (id, vault_id, folder_id, item_type, encrypted_data, encrypted_name,
           favorite, reprompt, trashed, created_at, updated_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           folder_id=excluded.folder_id, encrypted_data=excluded.encrypted_data,
           encrypted_name=excluded.encrypted_name, favorite=excluded.favorite,
           reprompt=excluded.reprompt, trashed=excluded.trashed,
           updated_at=excluded.updated_at, synced_at=excluded.synced_at`,
        [item.id, item.vaultId, item.folderId ?? null, item.itemType,
         item.encryptedData, item.encryptedName,
         item.favorite ? 1 : 0, item.reprompt ? 1 : 0, item.trashed ? 1 : 0,
         item.createdAt, item.updatedAt, now],
      );
    }
  });
}

export async function upsertFolders(folders: FolderResponse[]): Promise<void> {
  if (folders.length === 0) return;
  const d = getDb();
  const now = NOW();
  await d.withTransactionAsync(async () => {
    for (const f of folders) {
      await d.runAsync(
        `INSERT INTO folders (id, vault_id, encrypted_name, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           encrypted_name=excluded.encrypted_name, synced_at=excluded.synced_at`,
        [f.id, f.vaultId, f.encryptedName, f.createdAt, now],
      );
    }
  });
}

export async function updateSyncMeta(vaultId: string): Promise<void> {
  await getDb().runAsync(
    `INSERT INTO sync_meta (vault_id, last_synced_at) VALUES (?, ?)
     ON CONFLICT(vault_id) DO UPDATE SET last_synced_at=excluded.last_synced_at`,
    [vaultId, NOW()],
  );
}

export async function listVaults(): Promise<VaultResponse[]> {
  const rows = await getDb().getAllAsync<{
    id: string; name: string; type: 'personal' | 'shared'; org_id: string | null;
    role: string; encrypted_vault_key: string; sender_id: string;
    wrap_signature: string; created_at: string;
  }>('SELECT * FROM vaults ORDER BY name ASC');

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    orgId: r.org_id ?? undefined,
    role: r.role,
    encryptedVaultKey: r.encrypted_vault_key,
    senderId: r.sender_id,
    wrapSignature: r.wrap_signature,
    createdAt: r.created_at,
  }));
}

export async function listItems(
  vaultId: string,
  includetrashed = false,
): Promise<ItemResponse[]> {
  const rows = await getDb().getAllAsync<{
    id: string; vault_id: string; folder_id: string | null; item_type: string;
    encrypted_data: string; encrypted_name: string;
    favorite: number; reprompt: number; trashed: number;
    created_at: string; updated_at: string;
  }>(
    `SELECT * FROM items WHERE vault_id = ? AND trashed = ? ORDER BY updated_at DESC`,
    [vaultId, includetrashed ? 1 : 0],
  );

  return rows.map((r) => ({
    id: r.id,
    vaultId: r.vault_id,
    folderId: r.folder_id ?? undefined,
    itemType: r.item_type,
    encryptedData: r.encrypted_data,
    encryptedName: r.encrypted_name,
    favorite: r.favorite === 1,
    reprompt: r.reprompt === 1,
    trashed: r.trashed === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getItem(itemId: string): Promise<ItemResponse | null> {
  const row = await getDb().getFirstAsync<{
    id: string; vault_id: string; folder_id: string | null; item_type: string;
    encrypted_data: string; encrypted_name: string;
    favorite: number; reprompt: number; trashed: number;
    created_at: string; updated_at: string;
  }>('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!row) return null;
  return {
    id: row.id,
    vaultId: row.vault_id,
    folderId: row.folder_id ?? undefined,
    itemType: row.item_type,
    encryptedData: row.encrypted_data,
    encryptedName: row.encrypted_name,
    favorite: row.favorite === 1,
    reprompt: row.reprompt === 1,
    trashed: row.trashed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLastSyncedAt(vaultId: string): Promise<number> {
  const row = await getDb().getFirstAsync<{ last_synced_at: number }>(
    'SELECT last_synced_at FROM sync_meta WHERE vault_id = ?',
    [vaultId],
  );
  return row?.last_synced_at ?? 0;
}

export async function deleteVaultData(vaultId: string): Promise<void> {
  const d = getDb();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM items WHERE vault_id = ?', [vaultId]);
    await d.runAsync('DELETE FROM folders WHERE vault_id = ?', [vaultId]);
    await d.runAsync('DELETE FROM sync_meta WHERE vault_id = ?', [vaultId]);
    await d.runAsync('DELETE FROM vaults WHERE id = ?', [vaultId]);
  });
}

export async function clearAll(): Promise<void> {
  const d = getDb();
  await d.withTransactionAsync(async () => {
    await d.execAsync('DELETE FROM items; DELETE FROM folders; DELETE FROM sync_meta; DELETE FROM vaults;');
  });
}
