// SPDX-License-Identifier: AGPL-3.0-or-later

import { FolderId } from '../value-objects/FolderId';
import { VaultId } from '../value-objects/VaultId';
import { EncryptedBlob } from '../value-objects/EncryptedBlob';

export interface FolderProps {
  readonly id: FolderId;
  readonly vaultId: VaultId;
  readonly encryptedName: EncryptedBlob;
  readonly createdAt: Date;
}

export class Folder {
  readonly id: FolderId;
  readonly vaultId: VaultId;
  readonly encryptedName: EncryptedBlob;
  readonly createdAt: Date;

  private constructor(props: FolderProps) {
    this.id = props.id;
    this.vaultId = props.vaultId;
    this.encryptedName = props.encryptedName;
    this.createdAt = props.createdAt;
  }

  static create(props: FolderProps): Folder {
    return new Folder(props);
  }

  equals(other: Folder): boolean {
    return this.id.equals(other.id);
  }
}
