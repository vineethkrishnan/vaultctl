// SPDX-License-Identifier: AGPL-3.0-or-later

export interface VaultDto {
  id: string;
  name: string;
  type: 'personal' | 'shared';
  role: string;
  canWrite: boolean;
  orgId?: string;
  createdAt: string;
}

export interface SyncResultDto {
  vaultCount: number;
  itemCount: number;
}

export interface ActiveSessionDto {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  isCurrent: boolean;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}
