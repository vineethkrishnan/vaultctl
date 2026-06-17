// SPDX-License-Identifier: AGPL-3.0-or-later

import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { IVaultRepository } from '../../../domain/vault/ports/IVaultRepository';
import { IVaultApiPort } from '../../../domain/vault/ports/IVaultApiPort';
import { ISyncEngine } from '../../../domain/sync/ports/ISyncEngine';
import { VaultId } from '../../../domain/vault/value-objects/VaultId';
import { VaultLockedError, VaultNotFoundError, VaultWriteNotAllowedError } from '../../../domain/vault/errors/VaultErrors';
import { CreateItemInput } from '../../dtos/ItemDtos';

export interface CreateItemDeps {
  cryptoService: ICryptoService;
  vaultRepository: IVaultRepository;
  vaultApiPort: IVaultApiPort;
  syncEngine: ISyncEngine;
}

export class CreateItem {
  constructor(private readonly deps: CreateItemDeps) {}

  async execute(input: CreateItemInput): Promise<string> {
    const { cryptoService, vaultRepository, vaultApiPort, syncEngine } = this.deps;

    if (!cryptoService.isUnlocked()) throw new VaultLockedError();

    const vault = await vaultRepository.findById(VaultId.of(input.vaultId));
    if (!vault) throw new VaultNotFoundError(input.vaultId);
    if (!vault.canWrite) throw new VaultWriteNotAllowedError(input.vaultId);

    const plaintext = new TextEncoder().encode(JSON.stringify(input.data));
    const [encryptedData, encryptedName] = await Promise.all([
      cryptoService.encryptItemData(input.vaultId, plaintext),
      cryptoService.encryptItemName(input.vaultId, input.name),
    ]);

    const created = await vaultApiPort.createItem({
      vaultId: input.vaultId,
      folderId: input.folderId,
      itemType: input.itemType,
      encryptedData: encryptedData.value,
      encryptedName: encryptedName.value,
    });

    await syncEngine.syncVault(VaultId.of(input.vaultId));
    return created.id;
  }
}
