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

// The editor's trash button used to fire the DELETE immediately.

test.describe("Item editor delete confirmation", () => {
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
      itemType: "login",
      encryptedData: fakeEncrypt("{}"),
      encryptedName: fakeEncrypt("Precious"),
      favorite: false,
      reprompt: false,
      trashed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
  });

  async function openItem(page: import("@playwright/test").Page) {
    await loginViaUI(page);
    await page.getByRole("link", { name: /Precious/ }).click();
    await expect(page.getByPlaceholder("Item name")).toHaveValue("Precious", {
      timeout: 10_000,
    });
  }

  test("trash button asks first and cancelling does not delete", async ({ page }) => {
    let deleteCalled = false;
    await page.route("**/api/v1/vaults/vault-1/items/item-1", async (route) => {
      if (route.request().method() === "DELETE") deleteCalled = true;
      await route.fallback();
    });

    await openItem(page);
    await page.getByRole("button", { name: "Move to trash" }).first().click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Precious");

    // Nothing destructive may have happened yet.
    expect(deleteCalled).toBe(false);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(deleteCalled).toBe(false);

    // Still on the item, still present.
    await expect(page).toHaveURL(/\/items\/item-1/);
  });

  test("confirming moves the item to trash", async ({ page }) => {
    await openItem(page);
    await page.getByRole("button", { name: "Move to trash" }).first().click();

    const trashResponse = page.waitForResponse(
      (response) =>
        /\/items\/item-1$/.test(new URL(response.url()).pathname) &&
        response.request().method() === "DELETE",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Move to trash" })
      .click();
    await trashResponse;

    await expect(page).toHaveURL(/\/vault\/vault-1$/, { timeout: 10_000 });
    await expect(page.getByText("No items yet")).toBeVisible();
  });
});
