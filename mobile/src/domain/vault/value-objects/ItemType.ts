// SPDX-License-Identifier: AGPL-3.0-or-later

export const ITEM_TYPES = [
  'login',
  'secure_note',
  'credit_card',
  'identity',
  'api_key',
  'ssh_key',
  'passkey',
  'gpg_key',
] as const;

export type ItemTypeValue = (typeof ITEM_TYPES)[number];

export class ItemType {
  private constructor(readonly value: ItemTypeValue) {}

  static of(value: string): ItemType {
    if (!ITEM_TYPES.includes(value as ItemTypeValue)) {
      throw new Error(`Invalid item type: ${value}`);
    }
    return new ItemType(value as ItemTypeValue);
  }

  equals(other: ItemType): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
