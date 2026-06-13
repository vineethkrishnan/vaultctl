// SPDX-License-Identifier: AGPL-3.0-or-later

export type VaultTypeValue = 'personal' | 'shared';

export class VaultType {
  private constructor(readonly value: VaultTypeValue) {}

  static of(value: string): VaultType {
    if (value !== 'personal' && value !== 'shared') {
      throw new Error(`Invalid vault type: ${value}`);
    }
    return new VaultType(value);
  }

  get isPersonal(): boolean {
    return this.value === 'personal';
  }

  get isShared(): boolean {
    return this.value === 'shared';
  }

  equals(other: VaultType): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
