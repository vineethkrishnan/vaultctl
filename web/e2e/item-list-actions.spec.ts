// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect } from "@playwright/test";
import {
  createMockState,
  fakeEncrypt,
  loginViaUI,
  mockApiFull,
  stubCryptoWorker,
} from "./helpers/mock-api-full";

const data = (o: Record<string, string>) => fakeEncrypt(JSON.stringify(o));

test.describe("Item list actions", () => {
  test.beforeEach(async ({ page }) => {
    const state = createMockState({
      vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
      items: [
        { id: "item-1", itemType: "login", encryptedName: fakeEncrypt("GitHub"), encryptedData: data({ username: "work@vinelab.in", password: "pw-work", uri: "https://github.com" }) },
        { id: "item-2", itemType: "login", encryptedName: fakeEncrypt("GitHub"), encryptedData: data({ username: "personal@gmail.com", password: "pw-home", uri: "https://github.com" }) },
        { id: "item-3", itemType: "secure_note", encryptedName: fakeEncrypt("Recovery codes"), encryptedData: data({ notes: "secret" }) },
      ],
    });
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"])
      .catch(() => {});
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });
  });

  test("shows usernames so duplicate-site logins are distinguishable", async ({ page }) => {
    await expect(page.getByText("work@vinelab.in")).toBeVisible();
    await expect(page.getByText("personal@gmail.com")).toBeVisible();
  });

  test("filters by type and searches across username", async ({ page }) => {
    await page.getByLabel("Filter by type").selectOption("secure_note");
    await expect(page.getByText("Recovery codes")).toBeVisible();
    await expect(page.getByText("work@vinelab.in")).toHaveCount(0);

    await page.getByLabel("Filter by type").selectOption("all");
    await page.getByPlaceholder("Search name, username or URL").fill("personal@");
    await expect(page.getByText("personal@gmail.com")).toBeVisible();
    await expect(page.getByText("work@vinelab.in")).toHaveCount(0);
  });

  test("kebab menu copies the password", async ({ page }) => {
    await page.getByRole("button", { name: "Item actions" }).first().click();
    await page.getByRole("menuitem", { name: "Copy password" }).click();
    await expect(page.getByText(/Copied password/)).toBeVisible();
  });

  test("kebab menu toggles favorite (PUT) and moves to trash (DELETE)", async ({ page }) => {
    const putResp = page.waitForResponse(
      (r) =>
        /\/items\/item-1$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Item actions" }).first().click();
    await page.getByRole("menuitem", { name: "Add to favorites" }).click();
    await putResp;

    await page.getByRole("button", { name: "Item actions" }).first().click();
    await page.getByRole("menuitem", { name: "Move to trash" }).click();
    // Themed confirm dialog (no native window.confirm).
    const delResp = page.waitForResponse(
      (r) =>
        /\/items\/item-/.test(new URL(r.url()).pathname) &&
        r.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "Move to trash" }).click();
    await delResp;
  });
});
