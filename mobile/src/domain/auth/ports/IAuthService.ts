// SPDX-License-Identifier: AGPL-3.0-or-later

import { KDFParams } from '../value-objects/KDFParams';

export interface PreloginResult {
  salt: string;
  kdfParams: KDFParams;
}

export interface LoginInput {
  email: string;
  authHash: string;
}

export interface LoginSuccess {
  kind: 'success';
  userId: string;
  role: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  encryptedPrivateKey: string;
  vaults: RawVaultMembership[];
}

export interface LoginTotpRequired {
  kind: 'totp_required';
}

export type LoginResult = LoginSuccess | LoginTotpRequired;

export interface RawVaultMembership {
  vaultId: string;
  vaultType: string;
  encryptedVaultKey: string;
  senderId: string;
  wrapSignature: string;
  role: string;
}

export interface TotpInput {
  email: string;
  code: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  isCurrent: boolean;
}

export interface IAuthService {
  prelogin(email: string): Promise<PreloginResult>;
  login(input: LoginInput): Promise<LoginResult>;
  submitTotp(input: TotpInput): Promise<LoginSuccess>;
  refresh(): Promise<RefreshResult>;
  logout(): Promise<void>;
  listSessions(): Promise<SessionInfo[]>;
  revokeSession(sessionId: string): Promise<void>;
}
