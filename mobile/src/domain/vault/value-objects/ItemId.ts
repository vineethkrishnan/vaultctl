// SPDX-License-Identifier: AGPL-3.0-or-later

export class ItemId {
  private constructor(readonly value: string) {}

  static of(value: string): ItemId {
    if (!value || !value.trim()) throw new Error('ItemId cannot be empty');
    return new ItemId(value.trim());
  }

  equals(other: ItemId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
