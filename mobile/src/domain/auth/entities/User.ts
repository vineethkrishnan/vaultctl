// SPDX-License-Identifier: AGPL-3.0-or-later

import { UserId } from '../value-objects/UserId';
import { EncryptedBlob } from '../../vault/value-objects/EncryptedBlob';

export interface UserProps {
  readonly id: UserId;
  readonly role: string;
  readonly encryptedPrivateKey: EncryptedBlob;
  readonly publicKey: string;
}

export class User {
  readonly id: UserId;
  readonly role: string;
  readonly encryptedPrivateKey: EncryptedBlob;
  readonly publicKey: string;

  private constructor(props: UserProps) {
    this.id = props.id;
    this.role = props.role;
    this.encryptedPrivateKey = props.encryptedPrivateKey;
    this.publicKey = props.publicKey;
  }

  static create(props: UserProps): User {
    return new User(props);
  }

  equals(other: User): boolean {
    return this.id.equals(other.id);
  }
}
