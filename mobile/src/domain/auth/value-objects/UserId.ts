// SPDX-License-Identifier: AGPL-3.0-or-later

export class UserId {
  private constructor(readonly value: string) {}

  static of(value: string): UserId {
    if (!value || !value.trim()) throw new Error('UserId cannot be empty');
    return new UserId(value.trim());
  }

  equals(other: UserId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
