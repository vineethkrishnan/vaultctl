// SPDX-License-Identifier: AGPL-3.0-or-later

import { ItemId } from '../value-objects/ItemId';
import { VaultId } from '../value-objects/VaultId';
import { FolderId } from '../value-objects/FolderId';
import { ItemType } from '../value-objects/ItemType';
import { EncryptedBlob } from '../value-objects/EncryptedBlob';

export interface VaultItemProps {
  readonly id: ItemId;
  readonly vaultId: VaultId;
  readonly folderId?: FolderId;
  readonly itemType: ItemType;
  readonly encryptedData: EncryptedBlob;
  readonly encryptedName: EncryptedBlob;
  readonly isFavorite: boolean;
  readonly isReprompt: boolean;
  readonly isTrashed: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class VaultItem {
  readonly id: ItemId;
  readonly vaultId: VaultId;
  readonly folderId?: FolderId;
  readonly itemType: ItemType;
  readonly encryptedData: EncryptedBlob;
  readonly encryptedName: EncryptedBlob;
  readonly isFavorite: boolean;
  readonly isReprompt: boolean;
  readonly isTrashed: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: VaultItemProps) {
    this.id = props.id;
    this.vaultId = props.vaultId;
    this.folderId = props.folderId;
    this.itemType = props.itemType;
    this.encryptedData = props.encryptedData;
    this.encryptedName = props.encryptedName;
    this.isFavorite = props.isFavorite;
    this.isReprompt = props.isReprompt;
    this.isTrashed = props.isTrashed;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: VaultItemProps): VaultItem {
    return new VaultItem(props);
  }

  withFavorite(isFavorite: boolean): VaultItem {
    return new VaultItem({ ...this, isFavorite });
  }

  withTrashed(isTrashed: boolean): VaultItem {
    return new VaultItem({ ...this, isTrashed, updatedAt: new Date() });
  }

  equals(other: VaultItem): boolean {
    return this.id.equals(other.id);
  }
}
