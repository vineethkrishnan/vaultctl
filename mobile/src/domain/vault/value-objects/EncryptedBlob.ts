// SPDX-License-Identifier: AGPL-3.0-or-later

export class EncryptedBlob {
  private constructor(readonly value: string) {}

  static of(value: string): EncryptedBlob {
    if (!value || !value.trim()) throw new Error('EncryptedBlob cannot be empty');
    return new EncryptedBlob(value.trim());
  }

  equals(other: EncryptedBlob): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
