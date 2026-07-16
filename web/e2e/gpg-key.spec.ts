// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect } from "@playwright/test";
import {
  createMockState,
  fakeEncrypt,
  loginViaUI,
  mockApiFull,
  stubCryptoWorker,
  type MockState,
} from "./helpers/mock-api-full";

// A GPG backup is only worth having if the armored block comes back byte-exact:
// gpg --import rejects a block whose line structure or CRC line is altered.
const ARMORED = [
  "-----BEGIN PGP PRIVATE KEY BLOCK-----",
  "",
  "lQOYBGaBcdEBCADQ0hZ1t3vZ9Xk2mNpQrStUvWxYz0123456789abcdefghijklmn",
  "opqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/aBcDeFgHiJkLmNo",
  "=Ab3D",
  "-----END PGP PRIVATE KEY BLOCK-----",
  "",
].join("\n");

test.describe("GPG key items", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
      items: [],
    });
    state.items.push({
      id: "item-1",
      vaultId: "vault-1",
      folderId: null,
      itemType: "gpg_key",
      encryptedData: fakeEncrypt(
        JSON.stringify({
          uid: "Alice <alice@example.com>",
          keyId: "0x1234ABCD5678EF90",
          fingerprint: "ABCD 1234 EF56 7890 ABCD  1234 EF56 7890 ABCD 1234",
          keyType: "RSA 4096",
          expiresAt: "2030-01-01",
          publicKey: "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmQINBGaBcdE=\n=xY9z\n-----END PGP PUBLIC KEY BLOCK-----\n",
          privateKey: ARMORED,
          passphrase: "correct horse battery staple",
          notes: "## Backup\n\nOffline copy in the safe.",
          customFields: [],
        }),
      ),
      encryptedName: fakeEncrypt("Alice signing key"),
      favorite: false,
      reprompt: false,
      trashed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
  });

  async function open(page: import("@playwright/test").Page) {
    await loginViaUI(page);
    await page.getByRole("link", { name: /Alice signing key/ }).click();
    await expect(page.getByPlaceholder("Item name")).toHaveValue("Alice signing key", {
      timeout: 10_000,
    });
  }

  test("armored private key survives a load byte-exact", async ({ page }) => {
    await open(page);
    // Every newline, the blank line after the header, and the =CRC line must
    // come back untouched, or the restored key will not import.
    await expect(page.getByLabel("Private Key")).toHaveValue(ARMORED);
  });

  test("armored private key survives a round trip through save", async ({ page }) => {
    await open(page);

    // Edit an unrelated field so the save is a real write, not a no-op that
    // could pass without the key ever going through encrypt -> store -> decrypt.
    await page.getByLabel("Key ID").fill("0x9999FFFF1111AAAA");

    const saved = page.waitForResponse(
      (r) =>
        /\/items\/item-1$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save" }).click();
    expect((await saved).status()).toBe(200);
    await expect(page).toHaveURL(/\/vault\/vault-1$/, { timeout: 10_000 });

    // Reopen: the edit landed AND the armored block came back untouched.
    await page.getByRole("link", { name: /Alice signing key/ }).click();
    await expect(page.getByLabel("Key ID")).toHaveValue("0x9999FFFF1111AAAA", {
      timeout: 10_000,
    });
    await expect(page.getByLabel("Private Key")).toHaveValue(ARMORED);
  });

  test("private key is masked until revealed", async ({ page }) => {
    await open(page);
    const priv = page.getByLabel("Private Key");
    await expect(priv).toHaveClass(/text-security/);
    await page.getByTitle("Reveal").first().click();
    await expect(priv).not.toHaveClass(/text-security/);
    await expect(priv).toHaveValue(ARMORED);
  });

  test("shows GPG identifying fields and offers the type when creating", async ({ page }) => {
    await open(page);
    await expect(page.getByLabel("User ID")).toHaveValue("Alice <alice@example.com>");
    await expect(page.getByLabel("Key ID")).toHaveValue("0x1234ABCD5678EF90");
    await expect(page.getByText("GPG Key").first()).toBeVisible();

    // The type picker must render (ITEM_TYPE_ICONS[type]! crashes on a missing icon).
    await page.getByRole("link", { name: "New Item" }).first().click();
    await expect(page.getByRole("button", { name: "GPG Key" })).toBeVisible();
    await page.getByRole("button", { name: "GPG Key" }).click();
    await expect(page.getByLabel("User ID")).toBeVisible();
  });
});
