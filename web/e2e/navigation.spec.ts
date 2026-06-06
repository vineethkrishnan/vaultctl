// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect } from "@playwright/test";
import { mockApi } from "./helpers/mock-api";

test.describe("Navigation and routing", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("lock page shows the session-locked screen with a sign-in action", async ({
    page,
  }) => {
    await page.goto("/lock");
    await expect(
      page.getByRole("heading", { name: "Session Locked" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in again" })).toBeVisible();
  });

  test("lock page sign-in-again redirects to login", async ({ page }) => {
    await page.goto("/lock");
    await page.getByRole("button", { name: "Sign in again" }).click();
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
