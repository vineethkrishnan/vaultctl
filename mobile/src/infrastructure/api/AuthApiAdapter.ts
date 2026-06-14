// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  IAuthService,
  PreloginResult,
  LoginInput,
  LoginResult,
  TotpInput,
  LoginSuccess,
  RefreshResult,
} from '../../domain/auth/ports/IAuthService';
import { KDFParams } from '../../domain/auth/value-objects/KDFParams';
import { IServerConfigRepository } from '../../domain/auth/ports/IServerConfigRepository';
import { HttpClient } from './HttpClient';

interface RawPreloginResponse {
  salt: string;
  iterations: number;
  memoryKB: number;
  parallelism: number;
}

interface RawLoginResponse {
  userId: string;
  role: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  encryptedPrivateKey: string;
  vaults: Array<{
    vaultId: string;
    vaultType: string;
    encryptedVaultKey: string;
    senderId: string;
    wrapSignature: string;
    role: string;
  }>;
}

export class AuthApiAdapter implements IAuthService {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly serverConfig: IServerConfigRepository,
  ) {}

  async prelogin(email: string): Promise<PreloginResult> {
    const url = await this.serverConfig.load();
    if (!url) throw new Error('No server URL configured');

    const res = await fetch(
      `${url.value}/api/v1/auth/prelogin?email=${encodeURIComponent(email)}`,
    );
    if (!res.ok) throw new Error('Prelogin failed');
    const body = await res.json() as RawPreloginResponse;

    return {
      salt: body.salt,
      kdfParams: KDFParams.of(body.iterations, body.memoryKB, body.parallelism),
    };
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const { data, status } = await this.httpClient.fetch<RawLoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: input.email, authHash: input.authHash }),
    });

    if (status === 423) return { kind: 'totp_required' };
    if (status !== 200) throw new Error('Authentication failed');

    return this.mapLoginSuccess(data);
  }

  async submitTotp(input: TotpInput): Promise<LoginSuccess> {
    const { data, status } = await this.httpClient.fetch<RawLoginResponse>(
      '/auth/totp/code',
      {
        method: 'POST',
        body: JSON.stringify({ email: input.email, code: input.code }),
      },
    );
    if (status !== 200) throw new Error('TOTP verification failed');
    return this.mapLoginSuccess(data);
  }

  async refresh(): Promise<RefreshResult> {
    const { data, status } = await this.httpClient.fetch<{
      accessToken: string;
      refreshToken: string;
    }>('/auth/refresh', { method: 'POST' });
    if (status !== 200) throw new Error('Token refresh failed');
    return data;
  }

  async logout(): Promise<void> {
    await this.httpClient.fetch('/auth/logout', { method: 'POST' }).catch(() => {});
  }

  async listSessions(): Promise<import('../../domain/auth/ports/IAuthService').SessionInfo[]> {
    const { data, status } = await this.httpClient.fetch<{
      sessions: Array<{ id: string; createdAt: string; lastUsedAt: string; isCurrent: boolean }>;
    }>('/users/me/sessions', { method: 'GET' });
    if (status !== 200) throw new Error('Failed to list sessions');
    return data.sessions;
  }

  async revokeSession(sessionId: string): Promise<void> {
    const { status } = await this.httpClient.fetch(`/users/me/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (status !== 204) throw new Error('Failed to revoke session');
  }

  private mapLoginSuccess(data: RawLoginResponse): LoginSuccess {
    return {
      kind: 'success',
      userId: data.userId,
      role: data.role,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      sessionId: data.sessionId,
      encryptedPrivateKey: data.encryptedPrivateKey,
      vaults: data.vaults,
    };
  }
}
