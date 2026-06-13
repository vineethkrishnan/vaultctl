// SPDX-License-Identifier: AGPL-3.0-or-later

import { ISyncEngine } from '../../../domain/sync/ports/ISyncEngine';
import { SyncResultDto } from '../../dtos/VaultDtos';

export interface SyncAllDeps {
  syncEngine: ISyncEngine;
}

export class SyncAll {
  constructor(private readonly deps: SyncAllDeps) {}

  async execute(): Promise<SyncResultDto> {
    return this.deps.syncEngine.syncAll();
  }
}
