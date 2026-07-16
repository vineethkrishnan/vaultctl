// SPDX-License-Identifier: AGPL-3.0-or-later

import { ISyncEngine, SyncResult } from '../../domain/sync/ports/ISyncEngine';
import { IVaultApiPort, RawVaultData, RawItemData, RawFolderData } from '../../domain/vault/ports/IVaultApiPort';
import { IVaultRepository } from '../../domain/vault/ports/IVaultRepository';
import { IItemRepository } from '../../domain/vault/ports/IItemRepository';
import { IFolderRepository } from '../../domain/vault/ports/IFolderRepository';
import { VaultId } from '../../domain/vault/value-objects/VaultId';
import { Vault } from '../../domain/vault/entities/Vault';
import { VaultItem } from '../../domain/vault/entities/VaultItem';
import { Folder } from '../../domain/vault/entities/Folder';
import { VaultType } from '../../domain/vault/value-objects/VaultType';
import { VaultRole } from '../../domain/vault/value-objects/VaultRole';
import { EncryptedBlob } from '../../domain/vault/value-objects/EncryptedBlob';
import { UserId } from '../../domain/auth/value-objects/UserId';
import { ItemId } from '../../domain/vault/value-objects/ItemId';
import { FolderId } from '../../domain/vault/value-objects/FolderId';
import { ItemType } from '../../domain/vault/value-objects/ItemType';
import { openDatabase, getDatabase } from '../persistence/sqlite/DatabaseProvider';

export class SyncEngineImpl implements ISyncEngine {
  private currentSync: Promise<SyncResult> | null = null;

  constructor(
    private readonly vaultApiPort: IVaultApiPort,
    private readonly vaultRepository: IVaultRepository,
    private readonly itemRepository: IItemRepository,
    private readonly folderRepository: IFolderRepository,
  ) {}

  async openDatabase(): Promise<void> {
    await openDatabase();
  }

  async syncAll(): Promise<SyncResult> {
    if (this.currentSync) return this.currentSync;
    this.currentSync = this.doSyncAll().finally(() => {
      this.currentSync = null;
    });
    return this.currentSync;
  }

  private async doSyncAll(): Promise<SyncResult> {
    const rawVaults = await this.vaultApiPort.fetchVaults();
    const vaults = rawVaults.map(rawToVault);
    await this.vaultRepository.saveAll(vaults);

    let totalItems = 0;
    for (const vault of vaults) {
      const [rawItems, rawFolders] = await Promise.all([
        this.vaultApiPort.fetchItems(vault.id.value),
        this.vaultApiPort.fetchFolders(vault.id.value),
      ]);
      const items = toItems(rawItems);
      const folders = rawFolders.map(rawToFolder);
      await this.itemRepository.saveAll(items);
      await this.folderRepository.saveAll(folders);
      await this.updateSyncMeta(vault.id.value);
      totalItems += items.length;
    }

    return { vaultCount: vaults.length, itemCount: totalItems };
  }

  async syncVault(vaultId: VaultId): Promise<void> {
    const [rawItems, rawFolders] = await Promise.all([
      this.vaultApiPort.fetchItems(vaultId.value),
      this.vaultApiPort.fetchFolders(vaultId.value),
    ]);
    await this.itemRepository.saveAll(toItems(rawItems));
    await this.folderRepository.saveAll(rawFolders.map(rawToFolder));
    await this.updateSyncMeta(vaultId.value);
  }

  async isCacheValid(vaultId: VaultId, maxAgeMs = 24 * 60 * 60 * 1000): Promise<boolean> {
    const db = getDatabase();
    const row = await db.getFirstAsync<{ last_synced_at: number }>(
      'SELECT last_synced_at FROM sync_meta WHERE vault_id = ?',
      [vaultId.value],
    );
    if (!row || !row.last_synced_at) return false;
    return Date.now() - row.last_synced_at < maxAgeMs;
  }

  private async updateSyncMeta(vaultId: string): Promise<void> {
    await getDatabase().runAsync(
      `INSERT INTO sync_meta (vault_id, last_synced_at) VALUES (?, ?)
       ON CONFLICT(vault_id) DO UPDATE SET last_synced_at=excluded.last_synced_at`,
      [vaultId, Date.now()],
    );
  }
}

function rawToVault(r: RawVaultData): Vault {
  return Vault.create({
    id: VaultId.of(r.id),
    name: r.name,
    type: VaultType.of(r.type),
    role: VaultRole.of(r.role),
    encryptedVaultKey: EncryptedBlob.of(r.encryptedVaultKey),
    senderId: UserId.of(r.senderId),
    wrapSignature: r.wrapSignature,
    orgId: r.orgId,
    createdAt: new Date(r.createdAt),
  });
}

// Drops items this build cannot represent rather than rejecting the batch: a
// single item of a type added after this build shipped must not stop the whole
// vault from syncing.
function toItems(raw: RawItemData[]): VaultItem[] {
  const items: VaultItem[] = [];
  for (const r of raw) {
    const item = rawToItem(r);
    if (item) items.push(item);
    else console.warn(`sync: skipping item ${r.id} of unsupported type ${r.itemType}`);
  }
  return items;
}

// Returns null for an item this build cannot represent - see toItems.
function rawToItem(r: RawItemData): VaultItem | null {
  const itemType = ItemType.parse(r.itemType);
  if (!itemType) return null;
  return VaultItem.create({
    id: ItemId.of(r.id),
    vaultId: VaultId.of(r.vaultId),
    folderId: r.folderId ? FolderId.of(r.folderId) : undefined,
    itemType,
    encryptedData: EncryptedBlob.of(r.encryptedData),
    encryptedName: EncryptedBlob.of(r.encryptedName),
    isFavorite: r.favorite,
    isReprompt: r.reprompt,
    isTrashed: r.trashed,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  });
}

function rawToFolder(r: RawFolderData): Folder {
  return Folder.create({
    id: FolderId.of(r.id),
    vaultId: VaultId.of(r.vaultId),
    encryptedName: EncryptedBlob.of(r.encryptedName),
    createdAt: new Date(r.createdAt),
  });
}
