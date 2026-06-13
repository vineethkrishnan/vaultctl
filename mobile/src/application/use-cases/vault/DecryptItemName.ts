// SPDX-License-Identifier: AGPL-3.0-or-later

import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { EncryptedBlob } from '../../../domain/vault/value-objects/EncryptedBlob';
import { VaultLockedError } from '../../../domain/vault/errors/VaultErrors';

export interface DecryptItemNameDeps {
  cryptoService: ICryptoService;
}

export class DecryptItemName {
  constructor(private readonly deps: DecryptItemNameDeps) {}

  async execute(vaultId: string, encryptedName: string): Promise<string> {
    if (!this.deps.cryptoService.isUnlocked()) throw new VaultLockedError();
    return this.deps.cryptoService.decryptItemName(
      vaultId,
      EncryptedBlob.of(encryptedName),
    );
  }
}
