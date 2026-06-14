// SPDX-License-Identifier: AGPL-3.0-or-later

import { KDFParams } from '../../auth/value-objects/KDFParams';
import { EncryptedBlob } from '../../vault/value-objects/EncryptedBlob';

export interface DerivedKeys {
  authHash: Uint8Array;
  stretchedKey: Uint8Array;
}

export interface InitKeysInput {
  stretchedKey: Uint8Array;
  encryptedPrivateKey: string;
  vaults: Array<{
    vaultId: string;
    vaultType: string;
    encryptedVaultKey: string;
  }>;
}

export interface ICryptoService {
  deriveKeys(password: string, saltBase64: string, params: KDFParams): Promise<DerivedKeys>;
  toBase64(bytes: Uint8Array): string;
  initKeys(input: InitKeysInput): Promise<void>;
  decryptItemData(vaultId: string, blob: EncryptedBlob): Promise<Uint8Array>;
  encryptItemData(vaultId: string, plaintext: Uint8Array): Promise<EncryptedBlob>;
  decryptItemName(vaultId: string, blob: EncryptedBlob): Promise<string>;
  encryptItemName(vaultId: string, name: string): Promise<EncryptedBlob>;
  isUnlocked(): boolean;
  getStretchedKey(): Uint8Array | null;
  lock(): void;
}
