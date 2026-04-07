import { test, expect } from "@playwright/test";
import { mockApi } from "./helpers/mock-api";

test.describe("Authentication flows", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("redirects unauthenticated user to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login page renders email form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "vaultctl" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue" }),
    ).toBeVisible();
  });

  test("login flow: email → password → derives keys", async ({ page }) => {
    await page.goto("/login");

    // Step 1: email
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2: password appears
    await expect(page.getByLabel("Master Password")).toBeVisible();
    await expect(page.getByText("test@example.com")).toBeVisible();

    // Step 3: enter password and submit
    await page.getByLabel("Master Password").fill("test-master-password-123");
    await page.getByRole("button", { name: "Unlock" }).click();

    // KDF derivation happens (Argon2id with minimal params for test speed)
    // After login, should navigate away from /login
    // With mock returning empty vaults, it goes to vault/none or stays
    // The key test: login button changes to "Deriving keys..."
    await expect(
      page.getByRole("button", { name: /Deriving keys/ }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("register page renders form fields", async ({ page }) => {
    await page.goto("/register");
    await expect(
      page.getByRole("heading", { name: "Create Account" }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Master Password")).toBeVisible();
    await expect(page.getByLabel("Confirm Password")).toBeVisible();
  });

  test("register validates password confirmation", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill("new@example.com");
    await page.getByLabel("Name").fill("Test User");
    await page.getByLabel("Master Password").fill("secure-password-123");
    await page.getByLabel("Confirm Password").fill("different-password");
    await page.getByRole("button", { name: "Create Account" }).click();

    await expect(page.getByText("Passwords do not match")).toBeVisible();
  });

  test("register button disabled with empty fields", async ({ page }) => {
    await page.goto("/register");
    await expect(
      page.getByRole("button", { name: "Create Account" }),
    ).toBeDisabled();

    // Fill only some fields — still disabled
    await page.getByLabel("Email").fill("new@example.com");
    await expect(
      page.getByRole("button", { name: "Create Account" }),
    ).toBeDisabled();
  });

  test("login page links to register", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create one" }).click();
    await expect(page).toHaveURL(/\/register/);
  });

  test("register page links to login", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
