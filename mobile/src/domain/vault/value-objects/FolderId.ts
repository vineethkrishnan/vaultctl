// SPDX-License-Identifier: AGPL-3.0-or-later

export class FolderId {
  private constructor(readonly value: string) {}

  static of(value: string): FolderId {
    if (!value || !value.trim()) throw new Error('FolderId cannot be empty');
    return new FolderId(value.trim());
  }

  equals(other: FolderId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
