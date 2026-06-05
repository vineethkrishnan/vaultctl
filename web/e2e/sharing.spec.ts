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
// UI GAP: The vaultctl web client does not yet ship a sharing UI
// (no invite dialog, no member list panel, no role editor). We therefore
// verify the route mock contract directly via page.request so the backend
// API surface is still exercised under the same Playwright harness. Once
// the UI lands, drive it end-to-end and drop the direct fetches.

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
    expect(response.status).toBe(201);

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

  // TODO: once the sharing UI exists, replace these API fetches with a
  // click-through test that opens an invite dialog, types a user id,
  // asserts the invite POST fires, then asserts the member list updates.
  test.skip("end-to-end invite via UI (no UI yet)", async () => {
    // Placeholder - remove when the invite dialog ships.
  });
});
