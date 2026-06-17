// SPDX-License-Identifier: AGPL-3.0-or-later

import { container, makeUnlockWithPassword, makeSubmitTotp, makeEnableBiometricUnlock } from '../../container';
import { useAuthStore } from './useAuthStore';
import { TotpRequiredError } from '../../domain/auth/errors/AuthErrors';

export function useAuth() {
  const store = useAuthStore();

  async function init(): Promise<void> {
    await container.syncEngine.openDatabase();
    const serverUrl = await container.serverConfig.load();
    const session = await container.sessionRepository.load();
    store.setHasServerUrl(serverUrl !== null);

    if (session) {
      store.setAuthenticated(session.userId.value);
      store.setLocked(true);
    }

    store.setReady(true);
  }

  async function configureServer(serverUrl: string): Promise<void> {
    await container.configureServer.execute({ serverUrl });
    store.setHasServerUrl(true);
  }

  async function login(email: string, password: string): Promise<{ requiresTOTP: boolean }> {
    try {
      const result = await container.login.execute({ email, password });
      if (!result.requiresTOTP) {
        const session = await container.sessionRepository.load();
        store.setAuthenticated(session?.userId.value ?? email);
      }
      return result;
    } catch (err) {
      if (err instanceof TotpRequiredError) return { requiresTOTP: true };
      throw err;
    }
  }

  async function submitTotp(
    email: string,
    code: string,
    pendingStretchedKey: Uint8Array,
    pendingEncryptedPrivateKey: string,
    pendingVaults: Array<{ vaultId: string; vaultType: string; encryptedVaultKey: string }>,
  ): Promise<void> {
    const useCase = makeSubmitTotp(pendingStretchedKey, pendingEncryptedPrivateKey, pendingVaults);
    await useCase.execute({ email, code });
    const session = await container.sessionRepository.load();
    store.setAuthenticated(session?.userId.value ?? email);
  }

  async function unlockWithBiometric(): Promise<void> {
    await container.unlockWithBiometric.execute();
    store.setLocked(false);
  }

  async function unlockWithPassword(password: string): Promise<void> {
    const ctx = await container.unlockContextStore.load();
    if (!ctx) throw new Error('No unlock context found. Please log in again.');
    const useCase = makeUnlockWithPassword(ctx.email, ctx.encryptedPrivateKey, ctx.vaults);
    await useCase.execute({ password });
    store.setLocked(false);
  }

  async function lockVault(): Promise<void> {
    container.lockVault.execute();
    store.setLocked(true);
  }

  async function enableBiometric(): Promise<void> {
    const stretchedKey = container.cryptoService.getStretchedKey();
    if (!stretchedKey) throw new Error('Vault is locked. Unlock first to enable biometrics.');
    const ctx = await container.unlockContextStore.load();
    if (!ctx) throw new Error('No unlock context. Log in again first.');
    const useCase = makeEnableBiometricUnlock(stretchedKey, ctx.encryptedPrivateKey, ctx.vaults);
    await useCase.execute();
  }

  async function disableBiometric(): Promise<void> {
    await container.disableBiometricUnlock.execute();
  }

  async function logout(): Promise<void> {
    await container.logoutSession.execute();
    store.reset();
  }

  return {
    ...store,
    init,
    configureServer,
    login,
    submitTotp,
    unlockWithBiometric,
    unlockWithPassword,
    lockVault,
    enableBiometric,
    disableBiometric,
    logout,
  };
}
