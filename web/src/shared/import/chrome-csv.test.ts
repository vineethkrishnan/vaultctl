// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "./chrome-csv.js";
import { parsedItemArraySchema } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, "__fixtures__/chrome.csv"), "utf8");

describe("chrome-csv", () => {
  it("parses every row", async () => {
    const items = await parse(FIXTURE);
    expect(items).toHaveLength(3);
  });

  it("maps every row to a login, not a secure note", async () => {
    const items = await parse(FIXTURE);
    expect(items.map((item) => item.type)).toEqual(["login", "login", "login"]);
  });

  it("decodes credentials, uri, and note for the first row", async () => {
    const items = await parse(FIXTURE);
    const github = items[0];
    expect(github).toBeDefined();
    if (!github) return;
    expect(github.name).toBe("github.com");
    expect(github.data).toMatchObject({
      username: "octocat",
      password: "hunter2",
      uri: "https://github.com/login",
      notes: "Primary GitHub account",
    });
  });

  it("preserves a password containing a comma", async () => {
    const items = await parse(FIXTURE);
    const google = items[1];
    expect(google).toBeDefined();
    if (!google) return;
    expect(google.data["password"]).toBe("p@ss,word");
  });

  it("keeps multi-line notes intact", async () => {
    const items = await parse(FIXTURE);
    const example = items[2];
    expect(example).toBeDefined();
    if (!example) return;
    expect(example.data["notes"]).toContain("Multi");
    expect(example.data["notes"]).toContain("line note");
  });

  it("passes zod schema validation", async () => {
    const items = await parse(FIXTURE);
    expect(() => parsedItemArraySchema.parse(items)).not.toThrow();
  });
});
