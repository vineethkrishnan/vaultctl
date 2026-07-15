// SPDX-License-Identifier: AGPL-3.0-or-later

import { SyncEngineImpl } from '../../src/infrastructure/sync/SyncEngineImpl';
import { ItemType } from '../../src/domain/vault/value-objects/ItemType';
import { IVaultApiPort, RawItemData } from '../../src/domain/vault/ports/IVaultApiPort';
import { IVaultRepository } from '../../src/domain/vault/ports/IVaultRepository';
import { IItemRepository } from '../../src/domain/vault/ports/IItemRepository';
import { IFolderRepository } from '../../src/domain/vault/ports/IFolderRepository';
import { VaultId } from '../../src/domain/vault/value-objects/VaultId';
import { VaultItem } from '../../src/domain/vault/entities/VaultItem';

jest.mock('../../src/infrastructure/persistence/sqlite/DatabaseProvider', () => ({
  openDatabase: jest.fn(),
  getDatabase: () => ({ runAsync: jest.fn(), getFirstAsync: jest.fn() }),
}));

function rawItem(id: string, itemType: string): RawItemData {
  return {
    id,
    vaultId: 'vault-1',
    itemType,
    encryptedData: 'data-' + id,
    encryptedName: 'name-' + id,
    favorite: false,
    reprompt: false,
    trashed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeEngine(items: RawItemData[]) {
  const saveAll = jest.fn(async (_items: VaultItem[]) => {});

  const vaultApiPort = {
    fetchVaults: jest.fn(async () => []),
    fetchItems: jest.fn(async () => items),
    fetchFolders: jest.fn(async () => []),
  } as unknown as IVaultApiPort;

  const engine = new SyncEngineImpl(
    vaultApiPort,
    { saveAll: jest.fn() } as unknown as IVaultRepository,
    { saveAll } as unknown as IItemRepository,
    { saveAll: jest.fn() } as unknown as IFolderRepository,
  );

  return { engine, saveAll };
}

describe('ItemType.parse', () => {
  it('returns null for an unknown type instead of throwing', () => {
    expect(ItemType.parse('future_type')).toBeNull();
    expect(() => ItemType.of('future_type')).toThrow();
  });

  it('still parses known types', () => {
    expect(ItemType.parse('login')?.value).toBe('login');
  });
});

describe('syncVault with an item type this build does not know', () => {
  it('persists the known items instead of failing the whole vault sync', async () => {
    // A server that has gained a new item type must not brick an older client:
    // the unknown row is skipped, everything else still lands.
    const { engine, saveAll } = makeEngine([
      rawItem('item-1', 'login'),
      rawItem('item-2', 'future_type'),
      rawItem('item-3', 'secure_note'),
    ]);

    await expect(engine.syncVault(VaultId.of('vault-1'))).resolves.not.toThrow();

    expect(saveAll).toHaveBeenCalledTimes(1);
    const saved = saveAll.mock.calls[0]![0];
    expect(saved.map((i) => i.id.value)).toEqual(['item-1', 'item-3']);
  });

  it('does not skip anything when every type is known', async () => {
    const { engine, saveAll } = makeEngine([
      rawItem('item-1', 'login'),
      rawItem('item-2', 'ssh_key'),
    ]);

    await engine.syncVault(VaultId.of('vault-1'));

    const saved = saveAll.mock.calls[0]![0];
    expect(saved).toHaveLength(2);
  });
});
