// SPDX-License-Identifier: AGPL-3.0-or-later

import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function openDatabase(): Promise<void> {
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
    CREATE INDEX IF NOT EXISTS idx_items_favorite ON items(favorite);

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

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('Database not initialized - call openDatabase() first');
  return db;
}
