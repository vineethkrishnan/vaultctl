// SPDX-License-Identifier: AGPL-3.0-or-later

import { IVaultRepository } from '../../../domain/vault/ports/IVaultRepository';
import { Vault } from '../../../domain/vault/entities/Vault';
import { VaultId } from '../../../domain/vault/value-objects/VaultId';
import { VaultType } from '../../../domain/vault/value-objects/VaultType';
import { VaultRole } from '../../../domain/vault/value-objects/VaultRole';
import { EncryptedBlob } from '../../../domain/vault/value-objects/EncryptedBlob';
import { UserId } from '../../../domain/auth/value-objects/UserId';
import { getDatabase } from './DatabaseProvider';

interface VaultRow {
  id: string;
  name: string;
  type: string;
  org_id: string | null;
  role: string;
  encrypted_vault_key: string;
  sender_id: string;
  wrap_signature: string;
  created_at: string;
}

function rowToVault(row: VaultRow): Vault {
  return Vault.create({
    id: VaultId.of(row.id),
    name: row.name,
    type: VaultType.of(row.type),
    role: VaultRole.of(row.role),
    encryptedVaultKey: EncryptedBlob.of(row.encrypted_vault_key),
    senderId: UserId.of(row.sender_id),
    wrapSignature: row.wrap_signature,
    orgId: row.org_id ?? undefined,
    createdAt: new Date(row.created_at),
  });
}

export class VaultRepositorySQLite implements IVaultRepository {
  async saveAll(vaults: Vault[]): Promise<void> {
    const db = getDatabase();
    const now = Date.now();
    await db.withTransactionAsync(async () => {
      for (const v of vaults) {
        await db.runAsync(
          `INSERT INTO vaults (id, name, type, org_id, role, encrypted_vault_key, sender_id, wrap_signature, created_at, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name, type=excluded.type, role=excluded.role,
             encrypted_vault_key=excluded.encrypted_vault_key,
             sender_id=excluded.sender_id, wrap_signature=excluded.wrap_signature,
             synced_at=excluded.synced_at`,
          [v.id.value, v.name, v.type.value, v.orgId ?? null, v.role.value,
           v.encryptedVaultKey.value, v.senderId.value, v.wrapSignature,
           v.createdAt.toISOString(), now],
        );
      }
    });
  }

  async findAll(): Promise<Vault[]> {
    const rows = await getDatabase().getAllAsync<VaultRow>(
      'SELECT * FROM vaults ORDER BY name ASC',
    );
    return rows.map(rowToVault);
  }

  async findById(id: VaultId): Promise<Vault | null> {
    const row = await getDatabase().getFirstAsync<VaultRow>(
      'SELECT * FROM vaults WHERE id = ?',
      [id.value],
    );
    return row ? rowToVault(row) : null;
  }

  async deleteById(id: VaultId): Promise<void> {
    await getDatabase().runAsync('DELETE FROM vaults WHERE id = ?', [id.value]);
  }

  async deleteAll(): Promise<void> {
    await getDatabase().runAsync('DELETE FROM vaults');
  }
}
