// SPDX-License-Identifier: AGPL-3.0-or-later

import { VaultId } from '../value-objects/VaultId';
import { VaultType } from '../value-objects/VaultType';
import { VaultRole } from '../value-objects/VaultRole';
import { EncryptedBlob } from '../value-objects/EncryptedBlob';
import { UserId } from '../../auth/value-objects/UserId';

export interface VaultProps {
  readonly id: VaultId;
  readonly name: string;
  readonly type: VaultType;
  readonly role: VaultRole;
  readonly encryptedVaultKey: EncryptedBlob;
  readonly senderId: UserId;
  readonly wrapSignature: string;
  readonly orgId?: string;
  readonly createdAt: Date;
}

export class Vault {
  readonly id: VaultId;
  readonly name: string;
  readonly type: VaultType;
  readonly role: VaultRole;
  readonly encryptedVaultKey: EncryptedBlob;
  readonly senderId: UserId;
  readonly wrapSignature: string;
  readonly orgId?: string;
  readonly createdAt: Date;

  private constructor(props: VaultProps) {
    if (!props.name.trim()) throw new Error('Vault name cannot be empty');
    this.id = props.id;
    this.name = props.name.trim();
    this.type = props.type;
    this.role = props.role;
    this.encryptedVaultKey = props.encryptedVaultKey;
    this.senderId = props.senderId;
    this.wrapSignature = props.wrapSignature;
    this.orgId = props.orgId;
    this.createdAt = props.createdAt;
  }

  static create(props: VaultProps): Vault {
    return new Vault(props);
  }

  get canWrite(): boolean {
    return this.role.canWrite;
  }

  equals(other: Vault): boolean {
    return this.id.equals(other.id);
  }
}
