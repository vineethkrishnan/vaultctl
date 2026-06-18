// SPDX-License-Identifier: AGPL-3.0-or-later

import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';
import { IPinService } from '../../../domain/crypto/ports/IPinService';

export interface UnlockWithPinDeps {
  cryptoService: ICryptoService;
  pinService: IPinService;
}

export class UnlockWithPin {
  constructor(private readonly deps: UnlockWithPinDeps) {}

  async execute(pin: string): Promise<void> {
    const payload = await this.deps.pinService.unlock(pin);
    await this.deps.cryptoService.initKeys({
      stretchedKey: payload.stretchedKey,
      encryptedPrivateKey: payload.encryptedPrivateKey,
      vaults: payload.vaults,
    });
  }
}
