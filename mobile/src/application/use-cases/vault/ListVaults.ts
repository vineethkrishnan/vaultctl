// SPDX-License-Identifier: AGPL-3.0-or-later

import { IVaultRepository } from '../../../domain/vault/ports/IVaultRepository';
import { VaultDto } from '../../dtos/VaultDtos';

export interface ListVaultsDeps {
  vaultRepository: IVaultRepository;
}

export class ListVaults {
  constructor(private readonly deps: ListVaultsDeps) {}

  async execute(): Promise<VaultDto[]> {
    const vaults = await this.deps.vaultRepository.findAll();
    return vaults.map((v) => ({
      id: v.id.value,
      name: v.name,
      type: v.type.value,
      role: v.role.value,
      canWrite: v.canWrite,
      orgId: v.orgId,
      createdAt: v.createdAt.toISOString(),
    }));
  }
}
