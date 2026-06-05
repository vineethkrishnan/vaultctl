// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Page } from "@playwright/test";

/**
 * Mocks the vaultctl API endpoints for E2E tests.
 * Uses Playwright route interception - no real backend needed.
 */

// Fake prelogin response with minimal KDF params for fast test derivation
const PRELOGIN_RESPONSE = {
  salt: "AAAAAAAAAAAAAAAAAAAAAA==", // 16 zero bytes base64
  iterations: 1,
  memoryKB: 19456,
  parallelism: 1,
};

// Fake login response - encrypted keys are garbage (we can't decrypt them
// without real keygen, but the UI flow still exercises navigation + state)
const LOGIN_RESPONSE = {
  userId: "test-user-id",
  role: "owner",
  accessToken: "fake-jwt-access",
  refreshToken: "fake-jwt-refresh",
  sessionId: "test-session-id",
  refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  encryptedPrivateKey: "AQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  encryptedIdentityPrivateKey: "AQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  publicKeySignature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  identityPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  vaults: [],
};

const REGISTER_RESPONSE = {
  userId: "new-user-id",
  role: "member",
};

export async function mockApi(page: Page) {
  // Health
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({ json: { status: "ok" } }),
  );

  // Config
  await page.route("**/api/v1/config", (route) =>
    route.fulfill({ json: { version: "v1", registrationMode: "open" } }),
  );

  // Prelogin
  await page.route("**/api/v1/auth/prelogin*", (route) =>
    route.fulfill({ json: PRELOGIN_RESPONSE }),
  );

  // Register
  await page.route("**/api/v1/auth/register", (route) =>
    route.fulfill({ status: 201, json: REGISTER_RESPONSE }),
  );

  // Login
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({ json: LOGIN_RESPONSE }),
  );

  // Refresh
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({
      json: {
        accessToken: "refreshed-jwt",
        refreshToken: "refreshed-rt",
        refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    }),
  );

  // Vaults list
  await page.route("**/api/v1/vaults", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: [] });
    }
    // POST create vault
    return route.fulfill({
      status: 201,
      json: {
        id: "vault-1",
        name: "Personal Vault",
        type: "personal",
        role: "owner",
        encryptedVaultKey: "",
        senderId: "new-user-id",
        wrapSignature: "",
        createdAt: new Date().toISOString(),
      },
    });
  });

  // Items list
  await page.route("**/api/v1/vaults/*/items", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: [] });
    }
    // POST create item
    return route.fulfill({
      status: 201,
      json: {
        id: "item-1",
        vaultId: "vault-1",
        itemType: "login",
        encryptedData: "",
        encryptedName: "",
        favorite: false,
        reprompt: false,
        trashed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  });

  // Folders
  await page.route("**/api/v1/vaults/*/folders", (route) =>
    route.fulfill({ json: [] }),
  );

  // Trash
  await page.route("**/api/v1/vaults/*/trash", (route) =>
    route.fulfill({ json: [] }),
  );

  // Logout
  await page.route("**/api/v1/auth/logout", (route) =>
    route.fulfill({ status: 204 }),
  );

  // Step-up
  await page.route("**/api/v1/auth/step-up", (route) =>
    route.fulfill({ json: { accessToken: "step-up-jwt" } }),
  );
}
