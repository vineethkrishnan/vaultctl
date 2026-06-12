// SPDX-License-Identifier: AGPL-3.0-or-later

import { apiFetch } from './client';
import { useServerStore } from '../store/server';
import type {
  PreloginResponse,
  LoginResponse,
  RefreshResponse,
} from '@vaultctl/shared/types/api';

export async function prelogin(email: string): Promise<PreloginResponse> {
  const baseUrl = useServerStore.getState().serverUrl;
  if (!baseUrl) throw new Error('No server URL configured');

  const res = await fetch(
    `${baseUrl}/api/v1/auth/prelogin?email=${encodeURIComponent(email)}`,
  );
  if (!res.ok) throw new Error('Prelogin failed');
  return res.json() as Promise<PreloginResponse>;
}

export async function login(body: {
  email: string;
  authHash: string;
}): Promise<{ data: LoginResponse; status: number }> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function submitTotp(body: {
  email: string;
  code: string;
}): Promise<{ data: LoginResponse; status: number }> {
  return apiFetch<LoginResponse>('/auth/totp/code', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch {
    // Best-effort; local state cleared regardless.
  }
}

export async function stepUp(masterPassword: string): Promise<void> {
  const { data, status } = await apiFetch('/auth/step-up', {
    method: 'POST',
    body: JSON.stringify({ masterPassword }),
  });
  if (status !== 200) throw new Error('Step-up failed');
}

export interface ServerConfig {
  features: {
    Attachments: boolean;
    Sharing: boolean;
    Hibp: boolean;
    Require2FA: boolean;
    BackupSync: boolean;
  };
}

export async function fetchServerConfig(): Promise<ServerConfig | null> {
  try {
    const { data, status } = await apiFetch<ServerConfig>('/config');
    return status === 200 ? data : null;
  } catch {
    return null;
  }
}
