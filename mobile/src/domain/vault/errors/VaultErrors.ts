// SPDX-License-Identifier: AGPL-3.0-or-later

export class VaultNotFoundError extends Error {
  constructor(vaultId: string) {
    super(`Vault not found: ${vaultId}`);
    this.name = 'VaultNotFoundError';
  }
}

export class VaultLockedError extends Error {
  constructor() {
    super('Vault is locked. Unlock before accessing items.');
    this.name = 'VaultLockedError';
  }
}

export class VaultItemNotFoundError extends Error {
  constructor(itemId: string) {
    super(`Item not found: ${itemId}`);
    this.name = 'VaultItemNotFoundError';
  }
}

export class VaultWriteNotAllowedError extends Error {
  constructor(vaultId: string) {
    super(`Write access denied for vault: ${vaultId}`);
    this.name = 'VaultWriteNotAllowedError';
  }
}

export class DecryptionError extends Error {
  constructor(cause?: string) {
    super(cause ? `Decryption failed: ${cause}` : 'Decryption failed');
    this.name = 'DecryptionError';
  }
}
