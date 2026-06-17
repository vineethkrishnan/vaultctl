// SPDX-License-Identifier: AGPL-3.0-or-later

import { ISessionRepository } from '../../domain/auth/ports/ISessionRepository';
import { IServerConfigRepository } from '../../domain/auth/ports/IServerConfigRepository';

export interface ApiResponse<T> {
  data: T;
  status: number;
}

export class HttpClient {
  private refreshPromise: Promise<void> | null = null;

  constructor(
    private readonly sessionRepository: ISessionRepository,
    private readonly serverConfig: IServerConfigRepository,
  ) {}

  private async getBaseUrl(): Promise<string> {
    const url = await this.serverConfig.load();
    if (!url) throw new Error('No server URL configured');
    return url.value;
  }

  private async buildHeaders(init?: RequestInit): Promise<Headers> {
    const headers = new Headers(init?.headers);
    if (!headers.has('Content-Type') && init?.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    const session = await this.sessionRepository.load();
    if (session?.accessToken) {
      headers.set('Authorization', `Bearer ${session.accessToken}`);
    }
    return headers;
  }

  private async refreshTokens(): Promise<void> {
    const session = await this.sessionRepository.load();
    if (!session) throw new Error('SESSION_EXPIRED');

    const baseUrl = await this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });

    if (!res.ok) {
      await this.sessionRepository.clear();
      throw new Error('SESSION_EXPIRED');
    }

    const body = await res.json() as { accessToken: string; refreshToken: string };
    await this.sessionRepository.save(session.withTokens(body.accessToken, body.refreshToken));
  }

  async fetch<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
    const baseUrl = await this.getBaseUrl();
    const url = `${baseUrl}/api/v1${path}`;

    const doRequest = async (): Promise<Response> =>
      fetch(url, { ...init, headers: await this.buildHeaders(init) });

    let res = await doRequest();

    if (res.status === 401) {
      if (!this.refreshPromise) {
        this.refreshPromise = this.refreshTokens().finally(() => {
          this.refreshPromise = null;
        });
      }
      await this.refreshPromise;
      res = await doRequest();
    }

    const text = await res.text();
    const data: T =
      res.status === 204 || !text
        ? (undefined as T)
        : (() => {
            try {
              return JSON.parse(text) as T;
            } catch {
              return text as unknown as T;
            }
          })();

    return { data, status: res.status };
  }
}
