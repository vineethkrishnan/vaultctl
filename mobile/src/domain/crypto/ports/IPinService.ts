// SPDX-License-Identifier: AGPL-3.0-or-later

export interface PinUnlockPayload {
  stretchedKey: Uint8Array;
  encryptedPrivateKey: string;
  vaults: Array<{
    vaultId: string;
    vaultType: string;
    encryptedVaultKey: string;
  }>;
}

export interface PinLockoutState {
  lockedUntilMs: number | null;
  attemptsRemaining: number;
}

export interface IPinService {
  isSet(): Promise<boolean>;
  setup(pin: string, payload: PinUnlockPayload): Promise<void>;
  unlock(pin: string): Promise<PinUnlockPayload>;
  clear(): Promise<void>;
  getLockoutState(): Promise<PinLockoutState>;
}
