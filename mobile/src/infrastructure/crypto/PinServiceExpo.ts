// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PIN unlock: stores the vault unlock payload in the hardware-backed Keystore
 * (expo-secure-store), gated by an Argon2id PIN verifier with attempt lockout.
 *
 * A 4-digit PIN is low entropy, so it never derives the vault key directly.
 * The Keystore protects the payload at rest; the verifier + exponential backoff
 * + wipe-after-N stop online guessing on an unlocked device.
 */

import * as SecureStore from 'expo-secure-store';
import {
  IPinService,
  PinUnlockPayload,
  PinLockoutState,
} from '../../domain/crypto/ports/IPinService';
import { deriveArgon2id } from '../_legacy/crypto/argon2';
import { fromBase64, toBase64 } from '@vaultctl/shared/crypto/utils';

const PAYLOAD_SLOT = 'vaultctl_pin_payload';
const VERIFIER_SLOT = 'vaultctl_pin_verifier';
const LOCKOUT_SLOT = 'vaultctl_pin_lockout';

const MAX_ATTEMPTS = 10;
const VERIFIER_KDF = { iterations: 3, memoryKB: 65536, parallelism: 4 };

interface Verifier {
  saltB64: string;
  hashB64: string;
}

interface Lockout {
  failedAttempts: number;
  lockedUntilMs: number | null;
}

function backoffMs(failedAttempts: number): number {
  const schedule: Record<number, number> = {
    5: 30_000,
    6: 60_000,
    7: 5 * 60_000,
    8: 15 * 60_000,
    9: 60 * 60_000,
  };
  return schedule[failedAttempts] ?? 0;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function encodePayload(payload: PinUnlockPayload): string {
  return JSON.stringify({
    stretchedKey: Array.from(payload.stretchedKey),
    encryptedPrivateKey: payload.encryptedPrivateKey,
    vaults: payload.vaults,
  });
}

function decodePayload(raw: string): PinUnlockPayload {
  const parsed = JSON.parse(raw) as {
    stretchedKey: number[];
    encryptedPrivateKey: string;
    vaults: PinUnlockPayload['vaults'];
  };
  return {
    stretchedKey: new Uint8Array(parsed.stretchedKey),
    encryptedPrivateKey: parsed.encryptedPrivateKey,
    vaults: parsed.vaults,
  };
}

export class PinWrongError extends Error {
  constructor(public readonly attemptsRemaining: number) {
    super('PIN_WRONG');
    this.name = 'PinWrongError';
  }
}

export class PinLockedError extends Error {
  constructor(public readonly lockedUntilMs: number) {
    super('PIN_LOCKED');
    this.name = 'PinLockedError';
  }
}

export class PinNotSetError extends Error {
  constructor() {
    super('PIN_NOT_SET');
    this.name = 'PinNotSetError';
  }
}

export class PinServiceExpo implements IPinService {
  async isSet(): Promise<boolean> {
    try {
      const raw = await SecureStore.getItemAsync(VERIFIER_SLOT);
      return raw !== null;
    } catch {
      return false;
    }
  }

  async setup(pin: string, payload: PinUnlockPayload): Promise<void> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await deriveArgon2id(pin, salt, VERIFIER_KDF);
    const verifier: Verifier = { saltB64: toBase64(salt), hashB64: toBase64(hash) };

    await SecureStore.setItemAsync(VERIFIER_SLOT, JSON.stringify(verifier));
    await SecureStore.setItemAsync(PAYLOAD_SLOT, encodePayload(payload));
    await this.writeLockout({ failedAttempts: 0, lockedUntilMs: null });
  }

  async unlock(pin: string): Promise<PinUnlockPayload> {
    const verifierRaw = await SecureStore.getItemAsync(VERIFIER_SLOT);
    if (!verifierRaw) throw new PinNotSetError();

    const lockout = await this.readLockout();
    if (lockout.lockedUntilMs && Date.now() < lockout.lockedUntilMs) {
      throw new PinLockedError(lockout.lockedUntilMs);
    }

    const verifier = JSON.parse(verifierRaw) as Verifier;
    const candidate = await deriveArgon2id(pin, fromBase64(verifier.saltB64), VERIFIER_KDF);

    if (!constantTimeEquals(toBase64(candidate), verifier.hashB64)) {
      const failedAttempts = lockout.failedAttempts + 1;
      if (failedAttempts >= MAX_ATTEMPTS) {
        await this.clear();
        throw new PinWrongError(0);
      }
      const lockMs = backoffMs(failedAttempts);
      await this.writeLockout({
        failedAttempts,
        lockedUntilMs: lockMs > 0 ? Date.now() + lockMs : null,
      });
      throw new PinWrongError(MAX_ATTEMPTS - failedAttempts);
    }

    await this.writeLockout({ failedAttempts: 0, lockedUntilMs: null });
    const payloadRaw = await SecureStore.getItemAsync(PAYLOAD_SLOT);
    if (!payloadRaw) throw new PinNotSetError();
    return decodePayload(payloadRaw);
  }

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(VERIFIER_SLOT).catch(() => undefined),
      SecureStore.deleteItemAsync(PAYLOAD_SLOT).catch(() => undefined),
      SecureStore.deleteItemAsync(LOCKOUT_SLOT).catch(() => undefined),
    ]);
  }

  async getLockoutState(): Promise<PinLockoutState> {
    const lockout = await this.readLockout();
    const lockedUntilMs =
      lockout.lockedUntilMs && Date.now() < lockout.lockedUntilMs ? lockout.lockedUntilMs : null;
    return { lockedUntilMs, attemptsRemaining: MAX_ATTEMPTS - lockout.failedAttempts };
  }

  private async readLockout(): Promise<Lockout> {
    try {
      const raw = await SecureStore.getItemAsync(LOCKOUT_SLOT);
      if (!raw) return { failedAttempts: 0, lockedUntilMs: null };
      return JSON.parse(raw) as Lockout;
    } catch {
      return { failedAttempts: 0, lockedUntilMs: null };
    }
  }

  private async writeLockout(lockout: Lockout): Promise<void> {
    await SecureStore.setItemAsync(LOCKOUT_SLOT, JSON.stringify(lockout));
  }
}
