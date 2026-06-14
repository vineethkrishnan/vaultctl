// SPDX-License-Identifier: AGPL-3.0-or-later

import { SearchItems } from '../../src/application/use-cases/vault/SearchItems';
import { IItemRepository } from '../../src/domain/vault/ports/IItemRepository';
import { ICryptoService } from '../../src/domain/crypto/ports/ICryptoService';
import { VaultItem } from '../../src/domain/vault/entities/VaultItem';
import { VaultId } from '../../src/domain/vault/value-objects/VaultId';
import { ItemId } from '../../src/domain/vault/value-objects/ItemId';
import { ItemType } from '../../src/domain/vault/value-objects/ItemType';
import { EncryptedBlob } from '../../src/domain/vault/value-objects/EncryptedBlob';
import { VaultLockedError } from '../../src/domain/vault/errors/VaultErrors';

function makeItem(id: string, vaultId = 'vault-1'): VaultItem {
  return VaultItem.create({
    id: ItemId.of(id),
    vaultId: VaultId.of(vaultId),
    folderId: undefined,
    itemType: ItemType.of('login'),
    encryptedName: EncryptedBlob.of('enc-' + id),
    encryptedData: EncryptedBlob.of('data-' + id),
    isFavorite: false,
    isReprompt: false,
    isTrashed: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  });
}

function makeCryptoService(overrides: Partial<ICryptoService> = {}): ICryptoService {
  return {
    deriveKeys: jest.fn(),
    toBase64: jest.fn(),
    initKeys: jest.fn(),
    decryptItemData: jest.fn(),
    encryptItemData: jest.fn(),
    decryptItemName: jest.fn(),
    encryptItemName: jest.fn(),
    isUnlocked: jest.fn(() => true),
    getStretchedKey: jest.fn(() => null),
    lock: jest.fn(),
    ...overrides,
  };
}

function makeItemRepository(items: VaultItem[]): IItemRepository {
  return {
    saveAll: jest.fn(),
    findAll: jest.fn(async () => items),
    findByVaultId: jest.fn(async () => items),
    findById: jest.fn(),
    findFavorites: jest.fn(async () => items.filter((i) => i.isFavorite)),
    findTrashed: jest.fn(async () => items.filter((i) => i.isTrashed)),
    deleteById: jest.fn(),
    deleteByVaultId: jest.fn(),
    deleteAll: jest.fn(),
  };
}

describe('SearchItems', () => {
  it('returns empty array for blank query', async () => {
    const useCase = new SearchItems({
      itemRepository: makeItemRepository([makeItem('1')]),
      cryptoService: makeCryptoService(),
    });
    const results = await useCase.execute({ query: '   ' });
    expect(results).toEqual([]);
  });

  it('throws VaultLockedError when vault is locked', async () => {
    const useCase = new SearchItems({
      itemRepository: makeItemRepository([]),
      cryptoService: makeCryptoService({ isUnlocked: jest.fn(() => false) }),
    });
    await expect(useCase.execute({ query: 'github' })).rejects.toBeInstanceOf(VaultLockedError);
  });

  it('returns items whose decrypted name matches the query (case-insensitive)', async () => {
    const items = [makeItem('1'), makeItem('2'), makeItem('3')];
    const decryptedNames: Record<string, string> = {
      'enc-1': 'GitHub',
      'enc-2': 'Amazon',
      'enc-3': 'github enterprise',
    };

    const cryptoService = makeCryptoService({
      decryptItemName: jest.fn(async (_vaultId: string, blob: EncryptedBlob) => {
        return decryptedNames[blob.value] ?? '';
      }),
    });

    const useCase = new SearchItems({
      itemRepository: makeItemRepository(items),
      cryptoService,
    });

    const results = await useCase.execute({ query: 'github' });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.decryptedName)).toEqual(['GitHub', 'github enterprise']);
  });

  it('filters by vaultId when provided', async () => {
    const itemsVault1 = [makeItem('1', 'vault-1'), makeItem('2', 'vault-1')];
    const cryptoService = makeCryptoService({
      decryptItemName: jest.fn(async () => 'github'),
    });
    const repo = makeItemRepository(itemsVault1);

    const useCase = new SearchItems({ itemRepository: repo, cryptoService });
    await useCase.execute({ query: 'github', vaultId: 'vault-1' });

    expect(repo.findByVaultId).toHaveBeenCalledTimes(1);
    expect(repo.findAll).not.toHaveBeenCalled();
  });

  it('searches all vaults when no vaultId is provided', async () => {
    const items = [makeItem('1', 'vault-1'), makeItem('2', 'vault-2')];
    const cryptoService = makeCryptoService({
      decryptItemName: jest.fn(async () => 'github'),
    });
    const repo = makeItemRepository(items);

    const useCase = new SearchItems({ itemRepository: repo, cryptoService });
    await useCase.execute({ query: 'github' });

    expect(repo.findAll).toHaveBeenCalledTimes(1);
    expect(repo.findByVaultId).not.toHaveBeenCalled();
  });

  it('omits items where decryption fails', async () => {
    const items = [makeItem('1'), makeItem('2')];
    const cryptoService = makeCryptoService({
      decryptItemName: jest.fn(async (_vaultId: string, blob: EncryptedBlob) => {
        if (blob.value === 'enc-1') throw new Error('Decryption failed');
        return 'github';
      }),
    });

    const useCase = new SearchItems({ itemRepository: makeItemRepository(items), cryptoService });
    const results = await useCase.execute({ query: 'github' });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('2');
  });
});
