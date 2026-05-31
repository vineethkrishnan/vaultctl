// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect } from "@playwright/test";
import {
  createMockState,
  fakeEncrypt,
  loginViaUI,
  mockApiFull,
  stubCryptoWorker,
} from "./helpers/mock-api-full";

function trashedState() {
  return createMockState({
    vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
    items: [
      {
        id: "item-1",
        itemType: "login",
        trashed: true,
        encryptedName: fakeEncrypt("Old GitHub"),
        encryptedData: fakeEncrypt("{}"),
      },
    ],
  });
}

test.describe("Trash permanent delete", () => {
  test("themed confirm purges and refreshes the list (no native dialog)", async ({
    page,
  }) => {
    await stubCryptoWorker(page);
    await mockApiFull(page, trashedState());
    await loginViaUI(page);
    await page.getByRole("link", { name: "Trash" }).first().click();
    await expect(page).toHaveURL(/\/trash/, { timeout: 15_000 });

    await expect(page.getByText("Old GitHub")).toBeVisible();
    await page.getByTitle("Delete permanently").click();

    // Themed dialog, not window.confirm.
    await expect(page.getByRole("alertdialog")).toBeVisible();
    const delResp = page.waitForResponse(
      (r) =>
        /\/trash\/item-1$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "Delete forever" }).click();
    await delResp;

    // List is invalidated -> the item is gone.
    await expect(page.getByText("Old GitHub")).toHaveCount(0);
    await expect(page.getByText("Trash is empty")).toBeVisible();
  });

  test("a step-up-required purge prompts for the master password instead of silently failing", async ({
    page,
  }) => {
    await stubCryptoWorker(page);
    await mockApiFull(page, trashedState());
    // Force the server to demand step-up for the permanent delete.
    await page.route(/\/api\/v1\/vaults\/[^/]+\/trash\/[^/?]+$/, async (route) => {
      if (route.request().method() === "DELETE") {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "STEP_UP_REQUIRED", message: "Step-up required" },
          }),
        });
      }
      return route.fallback();
    });
    await loginViaUI(page);
    await page.getByRole("link", { name: "Trash" }).first().click();
    await expect(page).toHaveURL(/\/trash/, { timeout: 15_000 });

    await page.getByTitle("Delete permanently").click();
    await page.getByRole("button", { name: "Delete forever" }).click();

    // The step-up modal appears (previously the purge just silently failed).
    await expect(page.getByText("Confirm Identity")).toBeVisible();
    await expect(
      page.getByText("This action requires your master password."),
    ).toBeVisible();
  });
});
