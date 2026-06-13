// SPDX-License-Identifier: AGPL-3.0-or-later

export class ServerUrl {
  private constructor(readonly value: string) {}

  static of(value: string): ServerUrl {
    const trimmed = value.trim().replace(/\/$/, '');
    if (!trimmed) throw new Error('ServerUrl cannot be empty');
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      throw new Error('ServerUrl must start with http:// or https://');
    }
    return new ServerUrl(trimmed);
  }

  equals(other: ServerUrl): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
