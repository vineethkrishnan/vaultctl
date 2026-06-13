// SPDX-License-Identifier: AGPL-3.0-or-later

import { ServerUrl } from '../../../domain/auth/value-objects/ServerUrl';
import { IServerConfigRepository } from '../../../domain/auth/ports/IServerConfigRepository';
import { ConfigureServerInput } from '../../dtos/AuthDtos';

export class ConfigureServer {
  constructor(private readonly serverConfig: IServerConfigRepository) {}

  async execute(input: ConfigureServerInput): Promise<void> {
    const url = ServerUrl.of(input.serverUrl);
    await this.serverConfig.save(url);
  }
}
