// SPDX-License-Identifier: AGPL-3.0-or-later

import { ICryptoService } from '../../../domain/crypto/ports/ICryptoService';

export interface LockVaultDeps {
  cryptoService: ICryptoService;
}

export class LockVault {
  constructor(private readonly deps: LockVaultDeps) {}

  execute(): void {
    this.deps.cryptoService.lock();
  }
}
