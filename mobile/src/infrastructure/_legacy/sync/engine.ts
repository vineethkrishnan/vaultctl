// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sync engine: pulls encrypted data from the server and stores it in SQLite.
 *
 * We never decrypt anything here. The encrypted blobs from the server land
 * in SQLite exactly as received. The app decrypts on-demand in memory after
 * biometric unlock, using keys held in store/keys.ts.
 */

import { fetchVaults, fetchItems, fetchFolders } from '../api/vault';
import * as db from './db';

export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncResult {
  vaultCount: number;
  itemCount: number;
  error?: string;
}

let currentSync: Promise<SyncResult> | null = null;

/** Sync all vaults the current user has access to. Deduplicates concurrent calls. */
export async function syncAll(): Promise<SyncResult> {
  if (currentSync) return currentSync;

  currentSync = doSyncAll().finally(() => {
    currentSync = null;
  });

  return currentSync;
}

async function doSyncAll(): Promise<SyncResult> {
  const vaults = await fetchVaults();
  await db.upsertVaults(vaults);

  let totalItems = 0;
  for (const vault of vaults) {
    const [items, folders] = await Promise.all([
      fetchItems(vault.id),
      fetchFolders(vault.id),
    ]);
    await db.upsertItems(items);
    await db.upsertFolders(folders);
    await db.updateSyncMeta(vault.id);
    totalItems += items.length;
  }

  return { vaultCount: vaults.length, itemCount: totalItems };
}

/**
 * Sync a single vault. Used after creating/editing an item to pull the
 * authoritative server state back into the local cache.
 */
export async function syncVault(vaultId: string): Promise<void> {
  const [items, folders] = await Promise.all([
    fetchItems(vaultId),
    fetchFolders(vaultId),
  ]);
  await db.upsertItems(items);
  await db.upsertFolders(folders);
  await db.updateSyncMeta(vaultId);
}

/** Returns true if the local cache is fresh enough to read offline. */
export async function isCacheValid(
  vaultId: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<boolean> {
  const lastSync = await db.getLastSyncedAt(vaultId);
  return lastSync > 0 && Date.now() - lastSync < maxAgeMs;
}
