// SPDX-License-Identifier: AGPL-3.0-or-later

export const ITEM_TYPES = [
  'login',
  'secure_note',
  'credit_card',
  'identity',
  'api_key',
  'ssh_key',
  'passkey',
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

  // Non-throwing companion for data crossing the wire or coming back out of
  // SQLite. A server that knows a type this build does not must degrade to a
  // skipped row, never take the whole sync down with it.
  static parse(value: string): ItemType | null {
    return ITEM_TYPES.includes(value as ItemTypeValue)
      ? new ItemType(value as ItemTypeValue)
      : null;
  }

  equals(other: ItemType): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
