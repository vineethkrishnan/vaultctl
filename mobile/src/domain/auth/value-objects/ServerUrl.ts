// SPDX-License-Identifier: AGPL-3.0-or-later

export class ServerUrl {
  private constructor(readonly value: string) {}

  static of(value: string): ServerUrl {
    const trimmed = value.trim().replace(/\/$/, '');
    if (!trimmed) throw new Error('ServerUrl cannot be empty');

    if (trimmed.startsWith('http://')) {
      const host = (trimmed.slice('http://'.length).split('/')[0] ?? '').split(':')[0] ?? '';
      const isLocalhostEquivalent = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      if (!isLocalhostEquivalent) {
        throw new Error('ServerUrl must use https:// for non-localhost addresses');
      }
    } else if (!trimmed.startsWith('https://')) {
      throw new Error('ServerUrl must start with https://');
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
