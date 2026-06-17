// SPDX-License-Identifier: AGPL-3.0-or-later

import { ServerConfigRepository } from './infrastructure/config/ServerConfigRepository';
import { AutoLockRepository } from './infrastructure/config/AutoLockRepository';
import { UnlockContextStore } from './infrastructure/crypto/UnlockContextStore';
import { SessionRepository } from './infrastructure/crypto/SessionRepository';
import { CryptoServiceImpl } from './infrastructure/crypto/CryptoServiceImpl';
import { BiometricServiceExpo } from './infrastructure/crypto/BiometricServiceExpo';
import { HttpClient } from './infrastructure/api/HttpClient';
import { AuthApiAdapter } from './infrastructure/api/AuthApiAdapter';
import { VaultApiAdapter } from './infrastructure/api/VaultApiAdapter';
import { VaultRepositorySQLite } from './infrastructure/persistence/sqlite/VaultRepositorySQLite';
import { ItemRepositorySQLite } from './infrastructure/persistence/sqlite/ItemRepositorySQLite';
import { FolderRepositorySQLite } from './infrastructure/persistence/sqlite/FolderRepositorySQLite';
import { SyncEngineImpl } from './infrastructure/sync/SyncEngineImpl';

import { ConfigureServer } from './application/use-cases/auth/ConfigureServer';
import { Login } from './application/use-cases/auth/Login';
import { SubmitTotp } from './application/use-cases/auth/SubmitTotp';
import { UnlockWithPassword } from './application/use-cases/auth/UnlockWithPassword';
import { UnlockWithBiometric } from './application/use-cases/auth/UnlockWithBiometric';
import { LockVault } from './application/use-cases/auth/LockVault';
import { LogoutSession } from './application/use-cases/auth/LogoutSession';
import { EnableBiometricUnlock, DisableBiometricUnlock } from './application/use-cases/auth/EnableBiometricUnlock';
import { GetActiveSessions } from './application/use-cases/auth/GetActiveSessions';
import { RevokeSession } from './application/use-cases/auth/RevokeSession';
import { SyncAll } from './application/use-cases/vault/SyncAll';
import { SyncVault } from './application/use-cases/vault/SyncVault';
import { ListVaults } from './application/use-cases/vault/ListVaults';
import { ListItems } from './application/use-cases/vault/ListItems';
import { GetItem } from './application/use-cases/vault/GetItem';
import { DecryptItem } from './application/use-cases/vault/DecryptItem';
import { DecryptItemName } from './application/use-cases/vault/DecryptItemName';
import { CreateItem } from './application/use-cases/vault/CreateItem';
import { UpdateItem } from './application/use-cases/vault/UpdateItem';
import { DeleteItem } from './application/use-cases/vault/DeleteItem';
import { RestoreItem } from './application/use-cases/vault/RestoreItem';
import { ToggleFavorite } from './application/use-cases/vault/ToggleFavorite';
import { SearchItems } from './application/use-cases/vault/SearchItems';
import { ListFavorites } from './application/use-cases/vault/ListFavorites';
import { ListTrashed } from './application/use-cases/vault/ListTrashed';

const serverConfig = new ServerConfigRepository();
export const autoLockRepository = new AutoLockRepository();
const unlockContextStore = new UnlockContextStore();
const sessionRepository = new SessionRepository();
const cryptoService = new CryptoServiceImpl();
const biometricService = new BiometricServiceExpo();
const httpClient = new HttpClient(sessionRepository, serverConfig);
const authService = new AuthApiAdapter(httpClient, serverConfig);
const vaultApiPort = new VaultApiAdapter(httpClient);
const vaultRepository = new VaultRepositorySQLite();
const itemRepository = new ItemRepositorySQLite();
const folderRepository = new FolderRepositorySQLite();
const syncEngine = new SyncEngineImpl(
  vaultApiPort,
  vaultRepository,
  itemRepository,
  folderRepository,
);

export const container = {
  // Services
  cryptoService,
  biometricService,
  syncEngine,
  sessionRepository,
  serverConfig,
  unlockContextStore,

  // Auth use cases
  configureServer: new ConfigureServer(serverConfig),
  login: new Login({ authService, cryptoService, sessionRepository, unlockContextStore }),
  lockVault: new LockVault({ cryptoService }),
  unlockWithBiometric: new UnlockWithBiometric({ cryptoService, biometricService }),
  logoutSession: new LogoutSession({
    authService,
    cryptoService,
    biometricService,
    sessionRepository,
    unlockContextStore,
    vaultRepository,
    itemRepository,
    folderRepository,
  }),
  disableBiometricUnlock: new DisableBiometricUnlock(biometricService),
  getActiveSessions: new GetActiveSessions(authService),
  revokeSession: new RevokeSession(authService),

  // Vault use cases
  syncAll: new SyncAll({ syncEngine }),
  syncVault: new SyncVault({ syncEngine }),
  listVaults: new ListVaults({ vaultRepository }),
  listItems: new ListItems({ itemRepository }),
  getItem: new GetItem({ itemRepository }),
  decryptItem: new DecryptItem({ itemRepository, cryptoService }),
  decryptItemName: new DecryptItemName({ cryptoService }),
  createItem: new CreateItem({ cryptoService, vaultRepository, vaultApiPort, syncEngine }),
  updateItem: new UpdateItem({
    cryptoService,
    itemRepository,
    vaultRepository,
    vaultApiPort,
    syncEngine,
  }),
  deleteItem: new DeleteItem({ itemRepository, vaultRepository, vaultApiPort, syncEngine }),
  restoreItem: new RestoreItem({ itemRepository, vaultApiPort, syncEngine }),
  toggleFavorite: new ToggleFavorite({ itemRepository, vaultApiPort, syncEngine }),
  searchItems: new SearchItems({ itemRepository, cryptoService }),
  listFavorites: new ListFavorites({ itemRepository, cryptoService }),
  listTrashed: new ListTrashed({ itemRepository, cryptoService }),
} as const;

export type Container = typeof container;

export function makeSubmitTotp(
  pendingStretchedKey: Uint8Array,
  pendingEncryptedPrivateKey: string,
  pendingVaults: Array<{ vaultId: string; vaultType: string; encryptedVaultKey: string }>,
): SubmitTotp {
  return new SubmitTotp({
    authService,
    cryptoService,
    sessionRepository,
    pendingStretchedKey,
    pendingEncryptedPrivateKey,
    pendingVaults,
  });
}

export function makeUnlockWithPassword(
  currentEmail: string,
  encryptedPrivateKey: string,
  vaults: Array<{ vaultId: string; vaultType: string; encryptedVaultKey: string }>,
): UnlockWithPassword {
  return new UnlockWithPassword({
    authService,
    cryptoService,
    sessionRepository,
    currentEmail,
    encryptedPrivateKey,
    vaults,
  });
}

export function makeEnableBiometricUnlock(
  stretchedKey: Uint8Array,
  encryptedPrivateKey: string,
  vaults: Array<{ vaultId: string; vaultType: string; encryptedVaultKey: string }>,
): EnableBiometricUnlock {
  return new EnableBiometricUnlock({
    cryptoService,
    biometricService,
    stretchedKey,
    encryptedPrivateKey,
    vaults,
  });
}
