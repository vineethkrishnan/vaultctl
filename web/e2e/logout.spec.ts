// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect } from "@playwright/test";
import {
  createMockState,
  loginViaUI,
  mockApiFull,
  stubCryptoWorker,
} from "./helpers/mock-api-full";

// Regression: the sidebar "Log Out" used to clear local state without ever
// navigating, stranding the user on the vault page. It must revoke the session
// server-side and land on /login.
test.describe("Logout", () => {
  test("sidebar Log Out revokes the session and redirects to /login", async ({
    page,
  }) => {
    const state = createMockState({
      vaults: [{ id: "vault-1", name: "Personal", type: "personal" }],
      items: [],
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);

    let logoutCalled = false;
    await page.route("**/api/v1/auth/logout", (route) => {
      logoutCalled = true;
      return route.fulfill({ status: 204 });
    });

    await loginViaUI(page);
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log Out" }).click();

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    expect(logoutCalled).toBe(true);

    const refreshToken = await page.evaluate(() =>
      sessionStorage.getItem("vaultctl_rt"),
    );
    expect(refreshToken).toBeNull();
  });
});
