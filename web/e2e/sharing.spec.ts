// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect, type Page } from "@playwright/test";
import {
  createMockState,
  mockApiFull,
  stubCryptoWorker,
  type MockState,
} from "./helpers/mock-api-full";

// Run a fetch inside the page context so page.route() intercepts fire.
async function pageFetch(
  page: Page,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ url, init }) => {
      const response = await fetch(url, init);
      const text = await response.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: response.status, body };
    },
    { url, init },
  );
}

// Sharing flows - M15 owner/member/rekey contract.
//
// The direct fetches below pin the route contract. SharingPanel is driven
// through the UI in the block underneath.

test.describe.serial("Vault sharing - API contract", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      vaults: [{ id: "vault-1", name: "Team", type: "shared", role: "owner" }],
      members: {
        "vault-1": [{ userId: "owner-id", role: "owner", email: "owner@example.com" }],
      },
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);
    // Load any page so the mocks are attached to the context.
    await page.goto("/login");
  });

  test("lists existing members", async ({ page }) => {
    const response = await pageFetch(page, "/api/v1/vaults/vault-1/members");
    expect(response.status).toBe(200);
    const members = response.body as Array<{ userId: string; role: string }>;
    expect(members).toHaveLength(1);
    expect(members[0]!.userId).toBe("owner-id");
  });

  test("invites a new member and the state reflects it", async ({ page }) => {
    const response = await pageFetch(page, "/api/v1/vaults/vault-1/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "user-b",
        role: "member",
        email: "b@example.com",
      }),
    });
    expect(response.status).toBe(204);

    // Listing afterward shows the new member.
    const listResponse = await pageFetch(page, "/api/v1/vaults/vault-1/members");
    const members = listResponse.body as Array<{ userId: string }>;
    expect(members.map((member) => member.userId)).toContain("user-b");
  });

  test("removes a member and triggers rekey", async ({ page }) => {
    // Seed a second member to remove.
    state.members["vault-1"]!.push({
      userId: "user-b",
      role: "member",
      email: "b@example.com",
    });

    const removeResponse = await pageFetch(
      page,
      "/api/v1/vaults/vault-1/members/user-b",
      { method: "DELETE" },
    );
    expect(removeResponse.status).toBe(200);
    const body = removeResponse.body as { rekeyRequired: boolean };
    expect(body.rekeyRequired).toBe(true);

    // Client should then call rekey - simulate that call.
    const rekeyResponse = await pageFetch(page, "/api/v1/vaults/vault-1/rekey", {
      method: "PUT",
    });
    expect(rekeyResponse.status).toBe(200);
    expect(state.rekeyCalls).toBe(1);

    // Member list is shorter
    const listResponse = await pageFetch(page, "/api/v1/vaults/vault-1/members");
    const members = listResponse.body as Array<{ userId: string }>;
    expect(members.map((member) => member.userId)).not.toContain("user-b");
  });

});

test.describe.serial("Vault sharing - SharingPanel UI", () => {
  let state: MockState;

  test.beforeEach(async ({ page }) => {
    state = createMockState({
      vaults: [
        {
          id: "vault-1",
          name: "Team",
          type: "shared",
          role: "owner",
          orgId: "org-1",
        },
      ],
      orgMembers: {
        "org-1": [
          { userId: "test-user-id", role: "owner", email: "owner@example.com" },
        ],
      },
    });
    await stubCryptoWorker(page);
    await mockApiFull(page, state);

    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Master Password").fill("test-master-password-123");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page).toHaveURL(/\/vault\/vault-1/, { timeout: 15_000 });
  });

  test("shows the current members of a shared vault", async ({ page }) => {
    await expect(page.getByText("test-user-id")).toBeVisible();
  });

  test("invites a member and fires the wrapped share POST", async ({ page }) => {
    const sharePosts: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        path === "/api/v1/vaults/vault-1/members" &&
        request.method() === "POST"
      ) {
        sharePosts.push(JSON.parse(request.postData() ?? "{}"));
      }
    });

    await page.getByPlaceholder(/user id/i).fill("user-b");
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page.getByText("Invited user-b as Member")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("user-b", { exact: true })).toBeVisible();
    expect(sharePosts).toHaveLength(1);
    // The key must be wrapped client-side before it ever reaches the server.
    expect(sharePosts[0]!.recipientUserId).toBe("user-b");
    expect(sharePosts[0]!.encryptedVaultKey).toBeTruthy();
    expect(sharePosts[0]!.wrapSignature).toBeTruthy();
    expect(state.members["vault-1"]?.map((m) => m.userId)).toContain("user-b");
  });
});
