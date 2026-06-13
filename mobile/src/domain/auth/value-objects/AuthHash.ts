// SPDX-License-Identifier: AGPL-3.0-or-later

export class AuthHash {
  private constructor(readonly value: string) {}

  static of(value: string): AuthHash {
    if (!value || !value.trim()) throw new Error('AuthHash cannot be empty');
    return new AuthHash(value.trim());
  }

  toString(): string {
    return this.value;
  }
}
