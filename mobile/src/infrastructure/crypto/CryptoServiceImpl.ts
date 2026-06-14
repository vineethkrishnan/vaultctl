// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ICryptoService,
  DerivedKeys,
  InitKeysInput,
} from '../../domain/crypto/ports/ICryptoService';
import { KDFParams } from '../../domain/auth/value-objects/KDFParams';
import { EncryptedBlob } from '../../domain/vault/value-objects/EncryptedBlob';
import { deriveKeys as mobileKdfDeriveKeys } from '../_legacy/crypto/kdf';
import {
  initKeys,
  isUnlocked,
  getStretchedKey,
  lock,
  encryptData,
  decryptData,
  encryptName,
  decryptName,
} from '../_legacy/store/keys';
import { fromBase64, toBase64 } from '@vaultctl/shared/crypto/utils';

export class CryptoServiceImpl implements ICryptoService {
  async deriveKeys(
    password: string,
    saltBase64: string,
    params: KDFParams,
  ): Promise<DerivedKeys> {
    const salt = fromBase64(saltBase64);
    return mobileKdfDeriveKeys(password, salt, {
      iterations: params.iterations,
      memoryKB: params.memoryKB,
      parallelism: params.parallelism,
    });
  }

  async initKeys(input: InitKeysInput): Promise<void> {
    await initKeys({
      stretchedKey: input.stretchedKey,
      encryptedPrivateKey: input.encryptedPrivateKey,
      vaults: input.vaults.map((v) => ({
        vaultId: v.vaultId,
        vaultType: v.vaultType as 'personal' | 'shared',
        encryptedVaultKey: v.encryptedVaultKey,
      })),
    });
  }

  async decryptItemData(vaultId: string, blob: EncryptedBlob): Promise<Uint8Array> {
    return decryptData(vaultId, blob.value);
  }

  async encryptItemData(vaultId: string, plaintext: Uint8Array): Promise<EncryptedBlob> {
    const b64 = await encryptData(vaultId, plaintext);
    return EncryptedBlob.of(b64);
  }

  async decryptItemName(vaultId: string, blob: EncryptedBlob): Promise<string> {
    return decryptName(vaultId, blob.value);
  }

  async encryptItemName(vaultId: string, name: string): Promise<EncryptedBlob> {
    const b64 = await encryptName(vaultId, name);
    return EncryptedBlob.of(b64);
  }

  toBase64(bytes: Uint8Array): string {
    return toBase64(bytes);
  }

  isUnlocked(): boolean {
    return isUnlocked();
  }

  getStretchedKey(): Uint8Array | null {
    return getStretchedKey();
  }

  lock(): void {
    lock();
  }
}
