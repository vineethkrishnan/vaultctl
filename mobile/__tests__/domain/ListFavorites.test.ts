// SPDX-License-Identifier: AGPL-3.0-or-later

import { ListFavorites } from '../../src/application/use-cases/vault/ListFavorites';
import { IItemRepository } from '../../src/domain/vault/ports/IItemRepository';
import { ICryptoService } from '../../src/domain/crypto/ports/ICryptoService';
import { VaultItem } from '../../src/domain/vault/entities/VaultItem';
import { VaultId } from '../../src/domain/vault/value-objects/VaultId';
import { ItemId } from '../../src/domain/vault/value-objects/ItemId';
import { ItemType } from '../../src/domain/vault/value-objects/ItemType';
import { EncryptedBlob } from '../../src/domain/vault/value-objects/EncryptedBlob';
import { VaultLockedError } from '../../src/domain/vault/errors/VaultErrors';

function makeFavoriteItem(id: string): VaultItem {
  return VaultItem.create({
    id: ItemId.of(id),
    vaultId: VaultId.of('vault-1'),
    folderId: undefined,
    itemType: ItemType.of('login'),
    encryptedName: EncryptedBlob.of('enc-' + id),
    encryptedData: EncryptedBlob.of('data-' + id),
    isFavorite: true,
    isReprompt: false,
    isTrashed: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  });
}

function makeMocks(overrides: { unlocked?: boolean } = {}) {
  const itemRepository: IItemRepository = {
    saveAll: jest.fn(),
    findAll: jest.fn(),
    findByVaultId: jest.fn(),
    findById: jest.fn(),
    findFavorites: jest.fn(async () => [makeFavoriteItem('f1'), makeFavoriteItem('f2')]),
    findTrashed: jest.fn(),
    deleteById: jest.fn(),
    deleteByVaultId: jest.fn(),
    deleteAll: jest.fn(),
  };

  const cryptoService: ICryptoService = {
    deriveKeys: jest.fn(),
    toBase64: jest.fn(),
    initKeys: jest.fn(),
    decryptItemData: jest.fn(),
    encryptItemData: jest.fn(),
    decryptItemName: jest.fn(async (_vaultId: string, blob: EncryptedBlob) =>
      blob.value.replace('enc-', 'Decrypted-'),
    ),
    encryptItemName: jest.fn(),
    isUnlocked: jest.fn(() => overrides.unlocked ?? true),
    getStretchedKey: jest.fn(() => null),
    lock: jest.fn(),
  };

  return { itemRepository, cryptoService };
}

describe('ListFavorites', () => {
  it('throws VaultLockedError when vault is locked', async () => {
    const { itemRepository, cryptoService } = makeMocks({ unlocked: false });
    const useCase = new ListFavorites({ itemRepository, cryptoService });
    await expect(useCase.execute()).rejects.toBeInstanceOf(VaultLockedError);
  });

  it('returns all favorite items with decrypted names', async () => {
    const { itemRepository, cryptoService } = makeMocks();
    const useCase = new ListFavorites({ itemRepository, cryptoService });
    const results = await useCase.execute();

    expect(results).toHaveLength(2);
    expect(results[0]?.decryptedName).toBe('Decrypted-f1');
    expect(results[1]?.decryptedName).toBe('Decrypted-f2');
    expect(results.every((r) => r.isFavorite)).toBe(true);
  });

  it('omits decryptedName but keeps item when decryption fails', async () => {
    const { itemRepository, cryptoService } = makeMocks();
    (cryptoService.decryptItemName as jest.Mock).mockRejectedValueOnce(
      new Error('decrypt error'),
    );

    const useCase = new ListFavorites({ itemRepository, cryptoService });
    const results = await useCase.execute();

    expect(results).toHaveLength(2);
    expect(results[0]?.decryptedName).toBeUndefined();
    expect(results[1]?.decryptedName).toBe('Decrypted-f2');
  });
});
