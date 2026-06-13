// SPDX-License-Identifier: AGPL-3.0-or-later

import { Vault } from '../entities/Vault';
import { VaultId } from '../value-objects/VaultId';

export interface IVaultRepository {
  saveAll(vaults: Vault[]): Promise<void>;
  findAll(): Promise<Vault[]>;
  findById(id: VaultId): Promise<Vault | null>;
  deleteById(id: VaultId): Promise<void>;
  deleteAll(): Promise<void>;
}
