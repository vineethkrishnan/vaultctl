// SPDX-License-Identifier: AGPL-3.0-or-later

export class VaultId {
  private constructor(readonly value: string) {}

  static of(value: string): VaultId {
    if (!value || !value.trim()) throw new Error('VaultId cannot be empty');
    return new VaultId(value.trim());
  }

  equals(other: VaultId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
