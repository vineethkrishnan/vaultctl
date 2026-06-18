// SPDX-License-Identifier: AGPL-3.0-or-later

import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { IPinService } from '../../../domain/crypto/ports/IPinService';
import { VaultLockedError } from '../../../domain/vault/errors/VaultErrors';

export interface EnablePinUnlockDeps {
  cryptoService: ICryptoService;
  pinService: IPinService;
  encryptedPrivateKey: string;
  vaults: Array<{ vaultId: string; vaultType: string; encryptedVaultKey: string }>;
  stretchedKey: Uint8Array;
}

export class EnablePinUnlock {
  constructor(private readonly deps: EnablePinUnlockDeps) {}

  async execute(pin: string): Promise<void> {
    const { cryptoService, pinService } = this.deps;
    if (!cryptoService.isUnlocked()) throw new VaultLockedError();

    await pinService.setup(pin, {
      stretchedKey: this.deps.stretchedKey,
      encryptedPrivateKey: this.deps.encryptedPrivateKey,
      vaults: this.deps.vaults,
    });
  }
}

export class DisablePinUnlock {
  constructor(private readonly pinService: IPinService) {}

  async execute(): Promise<void> {
    await this.pinService.clear();
  }
}
