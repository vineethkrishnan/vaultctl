// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Page, type Route } from "@playwright/test";

// ===========================================================================
// Full-featured route mocking for vaultctl E2E tests.
//
// This helper accepts a mutable MockState and performs realistic CRUD
// simulation so tests can observe state changes triggered by the UI. Nothing
// ever leaves the browser - the mock is the entire backend.
//
// Encrypted blobs are opaque base64 strings. Names are base64-encoded
// plaintext on purpose so the companion stubCryptoWorker helper can
// "decrypt" them back to readable strings without a real key.
// ===========================================================================

// ===========================================================================
// Types
// ===========================================================================

export interface MockVault {
  id: string;
  name: string;
  type: "personal" | "shared";
  role: string;
  encryptedVaultKey: string;
  senderId: string;
  wrapSignature: string;
  createdAt: string;
}

export interface MockItem {
  id: string;
  vaultId: string;
  folderId: string | null;
  itemType: string;
  encryptedData: string;
  encryptedName: string;
  favorite: boolean;
  reprompt: boolean;
  trashed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MockFolder {
  id: string;
  vaultId: string;
  encryptedName: string;
  createdAt: string;
}

export interface MockSession {
  id: string;
  userId: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface MockMember {
  userId: string;
  role: string;
  email: string;
}

export interface MockState {
  userId: string;
  vaults: MockVault[];
  items: MockItem[];
  folders: MockFolder[];
  sessions: MockSession[];
  members: Record<string, MockMember[]>;
  rekeyCalls: number;
  importCalls: number;
  exportCalls: number;
}

export interface MockStateSeed {
  userId?: string;
  vaults?: Partial<MockVault>[];
  items?: Partial<MockItem>[];
  folders?: Partial<MockFolder>[];
  sessions?: Partial<MockSession>[];
  members?: Record<string, MockMember[]>;
}

// ===========================================================================
// Seed helpers
// ===========================================================================

const ISO_NOW = "2026-01-01T00:00:00.000Z";

// Base64-encode a utf-8 string. Used for fake "encrypted" blobs.
export function fakeEncrypt(plain: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(plain, "utf8").toString("base64");
  }
  return btoa(unescape(encodeURIComponent(plain)));
}

function makeVault(seed: Partial<MockVault>, index: number): MockVault {
  return {
    id: seed.id ?? `vault-${index + 1}`,
    name: seed.name ?? `Vault ${index + 1}`,
    type: seed.type ?? "personal",
    role: seed.role ?? "owner",
    encryptedVaultKey:
      seed.encryptedVaultKey ??
      "AQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    senderId: seed.senderId ?? "test-user-id",
    wrapSignature:
      seed.wrapSignature ??
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    createdAt: seed.createdAt ?? ISO_NOW,
  };
}

function makeItem(seed: Partial<MockItem>, index: number): MockItem {
  return {
    id: seed.id ?? `item-${index + 1}`,
    vaultId: seed.vaultId ?? "vault-1",
    folderId: seed.folderId ?? null,
    itemType: seed.itemType ?? "login",
    encryptedData: seed.encryptedData ?? fakeEncrypt("{}"),
    encryptedName: seed.encryptedName ?? fakeEncrypt(`Item ${index + 1}`),
    favorite: seed.favorite ?? false,
    reprompt: seed.reprompt ?? false,
    trashed: seed.trashed ?? false,
    createdAt: seed.createdAt ?? ISO_NOW,
    updatedAt: seed.updatedAt ?? ISO_NOW,
  };
}

function makeFolder(seed: Partial<MockFolder>, index: number): MockFolder {
  return {
    id: seed.id ?? `folder-${index + 1}`,
    vaultId: seed.vaultId ?? "vault-1",
    encryptedName: seed.encryptedName ?? fakeEncrypt(`Folder ${index + 1}`),
    createdAt: seed.createdAt ?? ISO_NOW,
  };
}

function makeSession(seed: Partial<MockSession>, index: number): MockSession {
  return {
    id: seed.id ?? `session-${index + 1}`,
    userId: seed.userId ?? "test-user-id",
    deviceName: seed.deviceName ?? `Device ${index + 1}`,
    createdAt: seed.createdAt ?? ISO_NOW,
    lastSeenAt: seed.lastSeenAt ?? ISO_NOW,
    current: seed.current ?? false,
  };
}

export function createMockState(seed: MockStateSeed = {}): MockState {
  return {
    userId: seed.userId ?? "test-user-id",
    vaults: (seed.vaults ?? []).map(makeVault),
    items: (seed.items ?? []).map(makeItem),
    folders: (seed.folders ?? []).map(makeFolder),
    sessions: (seed.sessions ?? []).map(makeSession),
    members: seed.members ?? {},
    rekeyCalls: 0,
    importCalls: 0,
    exportCalls: 0,
  };
}

// ===========================================================================
// Canned auth responses
// ===========================================================================

const PRELOGIN_RESPONSE = {
  salt: "AAAAAAAAAAAAAAAAAAAAAA==",
  iterations: 1,
  memoryKB: 19456,
  parallelism: 1,
};

function buildLoginResponse(state: MockState) {
  return {
    userId: state.userId,
    role: "owner",
    accessToken: "fake-jwt-access",
    refreshToken: "fake-jwt-refresh",
    sessionId: "test-session-id",
    refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    encryptedPrivateKey:
      "AQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    encryptedIdentityPrivateKey:
      "AQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    publicKeySignature:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    identityPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    vaults: state.vaults.map((vault) => ({
      vaultId: vault.id,
      vaultName: vault.name,
      vaultType: vault.type,
      encryptedVaultKey: vault.encryptedVaultKey,
      senderId: vault.senderId,
      wrapSignature: vault.wrapSignature,
      role: vault.role,
    })),
  };
}

// ===========================================================================
// URL matching
// ===========================================================================

interface RouteMatch {
  vaultId?: string;
  itemId?: string;
  folderId?: string;
}

function matchVaultItemsPath(path: string): RouteMatch | null {
  const match = /\/api\/v1\/vaults\/([^/?]+)\/items(?:\/([^/?]+))?(?:\?.*)?$/.exec(path);
  if (!match) return null;
  return { vaultId: match[1], itemId: match[2] };
}

function matchVaultFoldersPath(path: string): RouteMatch | null {
  const match = /\/api\/v1\/vaults\/([^/?]+)\/folders(?:\/([^/?]+))?(?:\?.*)?$/.exec(path);
  if (!match) return null;
  return { vaultId: match[1], folderId: match[2] };
}

function matchVaultTrashPath(
  path: string,
): { vaultId: string; itemId?: string; restore?: boolean } | null {
  const restoreMatch = /\/api\/v1\/vaults\/([^/?]+)\/trash\/([^/?]+)\/restore$/.exec(path);
  if (restoreMatch) {
    return { vaultId: restoreMatch[1]!, itemId: restoreMatch[2]!, restore: true };
  }
  const itemMatch = /\/api\/v1\/vaults\/([^/?]+)\/trash\/([^/?]+)$/.exec(path);
  if (itemMatch) {
    return { vaultId: itemMatch[1]!, itemId: itemMatch[2]! };
  }
  const listMatch = /\/api\/v1\/vaults\/([^/?]+)\/trash(?:\?.*)?$/.exec(path);
  if (listMatch) {
    return { vaultId: listMatch[1]! };
  }
  return null;
}

function matchVaultMembersPath(
  path: string,
): { vaultId: string; memberId?: string } | null {
  const memberMatch = /\/api\/v1\/vaults\/([^/?]+)\/members\/([^/?]+)$/.exec(path);
  if (memberMatch) {
    return { vaultId: memberMatch[1]!, memberId: memberMatch[2]! };
  }
  const listMatch = /\/api\/v1\/vaults\/([^/?]+)\/members(?:\?.*)?$/.exec(path);
  if (listMatch) {
    return { vaultId: listMatch[1]! };
  }
  return null;
}

function matchSessionsPath(path: string): { sessionId?: string } | null {
  const sessionMatch = /\/api\/v1\/users\/me\/sessions\/([^/?]+)$/.exec(path);
  if (sessionMatch) {
    return { sessionId: sessionMatch[1]! };
  }
  if (/\/api\/v1\/users\/me\/sessions(?:\?.*)?$/.test(path)) {
    return {};
  }
  return null;
}

// ===========================================================================
// Handler helpers
// ===========================================================================

async function parseBody(route: Route): Promise<Record<string, unknown>> {
  try {
    const raw = route.request().postData();
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function json<T>(data: T, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  };
}

// ===========================================================================
// Main entry
// ===========================================================================

export async function mockApiFull(page: Page, state: MockState): Promise<void> {
  // Health / config / auth
  await page.route("**/api/v1/health", (route) => route.fulfill(json({ status: "ok" })));

  await page.route("**/api/v1/config", (route) =>
    route.fulfill(json({ version: "v1", registrationMode: "open" })),
  );

  await page.route("**/api/v1/auth/prelogin*", (route) =>
    route.fulfill(json(PRELOGIN_RESPONSE)),
  );

  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill(json(buildLoginResponse(state))),
  );

  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill(
      json({
        accessToken: "refreshed-jwt",
        refreshToken: "refreshed-rt",
        refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    ),
  );

  await page.route("**/api/v1/auth/logout", (route) =>
    route.fulfill({ status: 204 }),
  );

  await page.route("**/api/v1/auth/step-up", (route) =>
    route.fulfill(json({ accessToken: "step-up-jwt" })),
  );

  // TOTP endpoints
  await page.route("**/api/v1/auth/totp/setup", (route) =>
    route.fulfill(
      json({
        secret: "JBSWY3DPEHPK3PXP",
        otpauthUrl:
          "otpauth://totp/vaultctl:test@example.com?secret=JBSWY3DPEHPK3PXP",
      }),
    ),
  );

  await page.route("**/api/v1/auth/totp/enable", (route) =>
    route.fulfill(json({ enabled: true })),
  );

  await page.route("**/api/v1/auth/totp/verify", (route) =>
    route.fulfill(json({ verified: true })),
  );

  // Vaults collection
  await page.route(/\/api\/v1\/vaults(\?.*)?$/, async (route) => {
    const method = route.request().method();

    if (method === "GET") {
      return route.fulfill(json(state.vaults));
    }

    if (method === "POST") {
      const body = await parseBody(route);
      const vault = makeVault(
        {
          id: `vault-${state.vaults.length + 1}`,
          name: (body.name as string | undefined) ?? "New Vault",
          type: (body.type as "personal" | "shared" | undefined) ?? "personal",
        },
        state.vaults.length,
      );
      state.vaults.push(vault);
      return route.fulfill(json(vault, 201));
    }

    return route.fulfill(json({ error: { code: "METHOD", message: "bad" } }, 405));
  });

  // Vault items (collection + detail)
  await page.route(
    /\/api\/v1\/vaults\/[^/]+\/items(\/[^/?]+)?(\?.*)?$/,
    async (route) => {
      const url = new URL(route.request().url());
      const routeMatch = matchVaultItemsPath(url.pathname);
      if (!routeMatch || !routeMatch.vaultId) {
        return route.fulfill(
          json({ error: { code: "BAD_PATH", message: "bad path" } }, 400),
        );
      }

      const { vaultId, itemId } = routeMatch;
      const method = route.request().method();

      // Collection
      if (!itemId) {
        if (method === "GET") {
          const favoritesOnly = url.searchParams.get("favorites") === "true";
          const folderFilter = url.searchParams.get("folderId");
          const list = state.items.filter((item) => {
            if (item.vaultId !== vaultId) return false;
            if (item.trashed) return false;
            if (favoritesOnly && !item.favorite) return false;
            if (folderFilter && item.folderId !== folderFilter) return false;
            return true;
          });
          return route.fulfill(json(list));
        }

        if (method === "POST") {
          const body = await parseBody(route);
          const item = makeItem(
            {
              id: `item-${state.items.length + 1}`,
              vaultId,
              itemType: (body.itemType as string | undefined) ?? "login",
              encryptedData: body.encryptedData as string | undefined,
              encryptedName: body.encryptedName as string | undefined,
              favorite: Boolean(body.favorite),
              reprompt: Boolean(body.reprompt),
            },
            state.items.length,
          );
          state.items.push(item);
          return route.fulfill(json(item, 201));
        }
      }

      // Detail
      if (itemId) {
        const index = state.items.findIndex(
          (item) => item.id === itemId && item.vaultId === vaultId,
        );

        if (method === "GET") {
          if (index === -1) {
            return route.fulfill(
              json({ error: { code: "NOT_FOUND", message: "" } }, 404),
            );
          }
          return route.fulfill(json(state.items[index]));
        }

        if (method === "PUT") {
          if (index === -1) {
            return route.fulfill(
              json({ error: { code: "NOT_FOUND", message: "" } }, 404),
            );
          }
          const body = await parseBody(route);
          const existing = state.items[index]!;
          const updated: MockItem = {
            ...existing,
            encryptedData:
              (body.encryptedData as string | undefined) ?? existing.encryptedData,
            encryptedName:
              (body.encryptedName as string | undefined) ?? existing.encryptedName,
            favorite:
              body.favorite !== undefined
                ? Boolean(body.favorite)
                : existing.favorite,
            reprompt:
              body.reprompt !== undefined
                ? Boolean(body.reprompt)
                : existing.reprompt,
            updatedAt: new Date().toISOString(),
          };
          state.items[index] = updated;
          return route.fulfill(json(updated));
        }

        if (method === "DELETE") {
          if (index !== -1) {
            state.items[index] = { ...state.items[index]!, trashed: true };
          }
          return route.fulfill({ status: 204 });
        }
      }

      return route.fulfill(json({ error: { code: "METHOD", message: "bad" } }, 405));
    },
  );

  // Vault folders
  await page.route(
    /\/api\/v1\/vaults\/[^/]+\/folders(\/[^/?]+)?(\?.*)?$/,
    async (route) => {
      const url = new URL(route.request().url());
      const routeMatch = matchVaultFoldersPath(url.pathname);
      if (!routeMatch || !routeMatch.vaultId) {
        return route.fulfill(json([]));
      }
      const method = route.request().method();

      if (!routeMatch.folderId) {
        if (method === "GET") {
          return route.fulfill(
            json(
              state.folders.filter((folder) => folder.vaultId === routeMatch.vaultId),
            ),
          );
        }
        if (method === "POST") {
          const body = await parseBody(route);
          const folder = makeFolder(
            {
              id: `folder-${state.folders.length + 1}`,
              vaultId: routeMatch.vaultId,
              encryptedName: body.encryptedName as string | undefined,
            },
            state.folders.length,
          );
          state.folders.push(folder);
          return route.fulfill(json(folder, 201));
        }
      }

      if (routeMatch.folderId && method === "DELETE") {
        const index = state.folders.findIndex((folder) => folder.id === routeMatch.folderId);
        if (index !== -1) state.folders.splice(index, 1);
        return route.fulfill({ status: 204 });
      }

      return route.fulfill(json([]));
    },
  );

  // Trash (must be registered before items regex? The items regex excludes /trash)
  await page.route(
    /\/api\/v1\/vaults\/[^/]+\/trash(\/[^/?]+(\/restore)?)?(\?.*)?$/,
    async (route) => {
      const url = new URL(route.request().url());
      const routeMatch = matchVaultTrashPath(url.pathname);
      if (!routeMatch) {
        return route.fulfill(json([]));
      }

      const method = route.request().method();

      if (routeMatch.restore && method === "POST") {
        const index = state.items.findIndex(
          (item) =>
            item.id === routeMatch.itemId && item.vaultId === routeMatch.vaultId,
        );
        if (index !== -1) {
          state.items[index] = { ...state.items[index]!, trashed: false };
        }
        return route.fulfill(json({ restored: true }));
      }

      if (routeMatch.itemId && method === "DELETE") {
        const index = state.items.findIndex(
          (item) =>
            item.id === routeMatch.itemId && item.vaultId === routeMatch.vaultId,
        );
        if (index !== -1) state.items.splice(index, 1);
        return route.fulfill({ status: 204 });
      }

      if (!routeMatch.itemId && method === "DELETE") {
        state.items = state.items.filter(
          (item) => !(item.vaultId === routeMatch.vaultId && item.trashed),
        );
        return route.fulfill({ status: 204 });
      }

      if (method === "GET") {
        const list = state.items.filter(
          (item) => item.vaultId === routeMatch.vaultId && item.trashed,
        );
        return route.fulfill(json(list));
      }

      return route.fulfill(json([]));
    },
  );

  // Vault members
  await page.route(
    /\/api\/v1\/vaults\/[^/]+\/members(\/[^/?]+)?(\?.*)?$/,
    async (route) => {
      const url = new URL(route.request().url());
      const routeMatch = matchVaultMembersPath(url.pathname);
      if (!routeMatch) {
        return route.fulfill(json([]));
      }

      const method = route.request().method();
      const members = state.members[routeMatch.vaultId] ?? [];
      state.members[routeMatch.vaultId] = members;

      if (!routeMatch.memberId) {
        if (method === "GET") return route.fulfill(json(members));
        if (method === "POST") {
          const body = await parseBody(route);
          const member: MockMember = {
            userId:
              (body.userId as string | undefined) ?? `user-${members.length + 1}`,
            role: (body.role as string | undefined) ?? "member",
            email: (body.email as string | undefined) ?? "new@example.com",
          };
          members.push(member);
          return route.fulfill(json(member, 201));
        }
      }

      if (routeMatch.memberId && method === "DELETE") {
        const index = members.findIndex(
          (member) => member.userId === routeMatch.memberId,
        );
        if (index !== -1) members.splice(index, 1);
        return route.fulfill(json({ rekeyRequired: true }));
      }

      return route.fulfill(json([]));
    },
  );

  // Vault rekey
  await page.route(/\/api\/v1\/vaults\/[^/]+\/rekey$/, async (route) => {
    state.rekeyCalls += 1;
    return route.fulfill(json({ ok: true }));
  });

  // Sessions
  await page.route(
    /\/api\/v1\/users\/me\/sessions(\/[^/?]+)?(\?.*)?$/,
    async (route) => {
      const url = new URL(route.request().url());
      const routeMatch = matchSessionsPath(url.pathname);
      if (!routeMatch) return route.fulfill(json([]));

      const method = route.request().method();

      if (!routeMatch.sessionId) {
        if (method === "GET") return route.fulfill(json(state.sessions));
      }

      if (routeMatch.sessionId && method === "DELETE") {
        const index = state.sessions.findIndex(
          (session) => session.id === routeMatch.sessionId,
        );
        if (index !== -1) state.sessions.splice(index, 1);
        return route.fulfill({ status: 204 });
      }

      return route.fulfill(json([]));
    },
  );

  // API keys (stub)
  await page.route(
    /\/api\/v1\/users\/me\/api-keys(\/[^/?]+)?(\?.*)?$/,
    (route) => {
      if (route.request().method() === "GET") return route.fulfill(json([]));
      return route.fulfill(json({ id: "apikey-1" }, 201));
    },
  );

  // Org members (stub)
  await page.route(
    /\/api\/v1\/orgs\/[^/]+\/members\/[^/?]+(\?.*)?$/,
    (route) => route.fulfill(json({ ok: true })),
  );

  // Import / Export (server-level)
  await page.route(/\/api\/v1\/import$/, (route) => {
    state.importCalls += 1;
    return route.fulfill(json({ imported: 0 }));
  });

  await page.route(/\/api\/v1\/export$/, (route) => {
    state.exportCalls += 1;
    return route.fulfill(
      json({
        version: 1,
        items: [],
        signature: "AAAA",
      }),
    );
  });
}

// ===========================================================================
// Crypto worker stub
// ===========================================================================

// Installs a stub for the Worker global so the crypto Web Worker never
// spawns a real module. Synthesizes responses for every op:
//   - init / lock / isUnlocked    -> success
//   - encrypt / encryptName       -> echo the base64 of the plaintext
//   - decrypt / decryptName       -> base64-decode the blob and return it
//   - verifyPassword              -> always true
export async function stubCryptoWorker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class StubWorker extends EventTarget {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: ((event: MessageEvent) => void) | null = null;

      constructor() {
        super();
        queueMicrotask(() => {
          this.dispatch({ op: "ready" });
        });
      }

      private dispatch(data: unknown): void {
        const event = new MessageEvent("message", { data });
        if (this.onmessage) this.onmessage(event);
        this.dispatchEvent(event);
      }

      postMessage(message: unknown): void {
        const payload = message as Record<string, unknown>;
        const op = payload.op as string;
        const requestId = payload.requestId as string | undefined;

        const decodeB64ToString = (b64: string): string => {
          try {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new TextDecoder().decode(bytes);
          } catch {
            return "";
          }
        };

        const decodeB64ToBytes = (b64: string): Uint8Array => {
          try {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return bytes;
          } catch {
            return new Uint8Array(0);
          }
        };

        const encodeStringToB64 = (plain: string): string => {
          try {
            const bytes = new TextEncoder().encode(plain);
            let bin = "";
            for (const byte of bytes) bin += String.fromCharCode(byte);
            return btoa(bin);
          } catch {
            return "";
          }
        };

        const bytesToB64 = (bytes: Uint8Array): string => {
          let bin = "";
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
          return btoa(bin);
        };

        queueMicrotask(() => {
          switch (op) {
            case "init":
              this.dispatch({ op: "initDone", requestId });
              return;

            case "lock":
              this.dispatch({ op: "locked" });
              return;

            case "isUnlocked":
              this.dispatch({ op: "resultBool", requestId, value: true });
              return;

            case "encrypt": {
              const plain = payload.plaintext as ArrayBuffer;
              const bytes = new Uint8Array(plain);
              this.dispatch({
                op: "resultString",
                requestId,
                value: bytesToB64(bytes),
              });
              return;
            }

            case "decrypt": {
              const blob = payload.blob as string;
              const bytes = decodeB64ToBytes(blob);
              const buffer = bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
              );
              this.dispatch({ op: "result", requestId, data: buffer });
              return;
            }

            case "encryptName": {
              const name = payload.name as string;
              this.dispatch({
                op: "resultString",
                requestId,
                value: encodeStringToB64(name),
              });
              return;
            }

            case "decryptName": {
              const blob = payload.blob as string;
              this.dispatch({
                op: "resultString",
                requestId,
                value: decodeB64ToString(blob),
              });
              return;
            }

            case "verifyPassword":
              this.dispatch({ op: "resultBool", requestId, value: true });
              return;

            default:
              this.dispatch({
                op: "error",
                requestId: requestId ?? "",
                message: `stub worker: unknown op ${op}`,
              });
          }
        });
      }

      terminate(): void {
        // no-op
      }
    }

    const globalObject = globalThis as unknown as { Worker: unknown };
    globalObject.Worker = StubWorker;
  });
}

// ===========================================================================
// Authenticated session setup
// ===========================================================================

// Seed sessionStorage with the keys the app expects after successful login
// (KDF params, email, identity pubkey).
export async function seedAuthStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("vaultctl_email", "test@example.com");
      sessionStorage.setItem("vaultctl_salt", "AAAAAAAAAAAAAAAAAAAAAA==");
      sessionStorage.setItem("vaultctl_kdf_iter", "1");
      sessionStorage.setItem("vaultctl_kdf_mem", "19456");
      sessionStorage.setItem("vaultctl_kdf_par", "1");
      sessionStorage.setItem(
        "vaultctl_id_pubkey",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
      );
      sessionStorage.setItem("vaultctl_rt", "fake-jwt-refresh");
      sessionStorage.setItem("vaultctl_sid", "test-session-id");
    } catch {
      /* storage unavailable */
    }
  });
}

// Drive the login page end-to-end with the mocked backend.
// Requires stubCryptoWorker + mockApiFull to have been installed first.
export async function loginViaUI(
  page: Page,
  email = "test@example.com",
  password = "test-master-password-123",
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Master Password").fill(password);
  await page.getByRole("button", { name: "Unlock" }).click();
}
