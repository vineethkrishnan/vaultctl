// SPDX-License-Identifier: AGPL-3.0-or-later

export class VaultRole {
  private constructor(readonly value: string) {}

  static of(value: string): VaultRole {
    if (!value || !value.trim()) throw new Error('VaultRole cannot be empty');
    return new VaultRole(value.trim());
  }

  get canWrite(): boolean {
    return this.value === 'owner' || this.value === 'editor';
  }

  get isOwner(): boolean {
    return this.value === 'owner';
  }

  equals(other: VaultRole): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
