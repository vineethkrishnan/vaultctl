// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, parseOnePassword1PUX } from "./onepassword-1pux.js";
import { parsedItemArraySchema } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_BYTES = new Uint8Array(
  readFileSync(join(__dirname, "__fixtures__/onepassword.1pux")),
);

describe("onepassword-1pux", () => {
  it("reads the ZIP container and yields three items", async () => {
    const items = await parse(FIXTURE_BYTES);
    expect(items).toHaveLength(3);
  });

  it("maps 1Password categories to vaultctl item types", async () => {
    const items = await parse(FIXTURE_BYTES);
    expect(items.map((item) => item.type)).toEqual([
      "login",
      "secure_note",
      "credit_card",
    ]);
  });

  it("decodes login credentials, url, and notes", async () => {
    const items = await parse(FIXTURE_BYTES);
    const github = items[0];
    expect(github).toBeDefined();
    if (!github) return;
    expect(github.name).toBe("GitHub");
    expect(github.data).toMatchObject({
      username: "octocat",
      password: "hunter2",
      uri: "https://github.com",
      totp: "otpauth://totp/example",
      notes: "Work account",
    });
  });

  it("decodes secure note content", async () => {
    const items = await parse(FIXTURE_BYTES);
    const note = items[1];
    expect(note).toBeDefined();
    if (!note) return;
    expect(note.name).toBe("Recovery Notes");
    expect(note.data["content"]).toBe("line one\nline two");
  });

  it("maps credit card sections to card fields", async () => {
    const items = await parse(FIXTURE_BYTES);
    const card = items[2];
    expect(card).toBeDefined();
    if (!card) return;
    expect(card.type).toBe("credit_card");
    expect(card.name).toBe("Visa");
    expect(card.data).toMatchObject({
      cardholderName: "Alice Doe",
      number: "4111 1111 1111 1111",
      expiry: "12/28",
      cvv: "123",
      cardType: "Visa",
    });
  });

  it("core parser accepts a pre-decoded JSON string directly", () => {
    const json = JSON.stringify({
      accounts: [
        {
          vaults: [
            {
              items: [
                {
                  categoryUuid: "001",
                  overview: { title: "X", url: "https://x" },
                  details: {
                    loginFields: [
                      { designation: "username", value: "u" },
                      { designation: "password", value: "p" },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const items = parseOnePassword1PUX(json);
    expect(items).toHaveLength(1);
    expect(items[0]).toBeDefined();
  });

  it("passes zod validation", async () => {
    const items = await parse(FIXTURE_BYTES);
    expect(() => parsedItemArraySchema.parse(items)).not.toThrow();
  });
});
