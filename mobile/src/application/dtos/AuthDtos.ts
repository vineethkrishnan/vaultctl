// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ConfigureServerInput {
  serverUrl: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginOutput {
  requiresTOTP: boolean;
  pendingEmail?: string;
}

export interface SubmitTotpInput {
  email: string;
  code: string;
}

export interface UnlockWithPasswordInput {
  password: string;
}

export interface SessionDto {
  userId: string;
  role: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}
