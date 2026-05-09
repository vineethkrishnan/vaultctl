// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect } from "@playwright/test";
import { mockApi } from "./helpers/mock-api";

test.describe("Navigation and routing", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("lock page renders password input and logout option", async ({
    page,
  }) => {
    await page.goto("/lock");
    await expect(
      page.getByRole("heading", { name: "Vault Locked" }),
    ).toBeVisible();
    await expect(page.getByLabel("Master Password")).toBeVisible();
    await expect(page.getByText("Log out instead")).toBeVisible();
  });

  test("lock page logout redirects to login", async ({ page }) => {
    await page.goto("/lock");
    await page.getByText("Log out instead").click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("login page change email goes back to email step", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByLabel("Master Password")).toBeVisible();
    await page.getByText("change").click();
    await expect(page.getByLabel("Email")).toBeVisible();
  });
});
