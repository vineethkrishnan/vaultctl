// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "./firefox-csv.js";
import { parsedItemArraySchema } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, "__fixtures__/firefox.csv"), "utf8");

describe("firefox-csv", () => {
  it("parses every row", async () => {
    const items = await parse(FIXTURE);
    expect(items).toHaveLength(3);
  });

  it("maps every row to a login, not a secure note", async () => {
    const items = await parse(FIXTURE);
    expect(items.map((item) => item.type)).toEqual(["login", "login", "login"]);
  });

  it("derives the entry name from the url host", async () => {
    const items = await parse(FIXTURE);
    const github = items[0];
    expect(github).toBeDefined();
    if (!github) return;
    expect(github.name).toBe("github.com");
    expect(github.data).toMatchObject({
      username: "octocat",
      password: "hunter2",
      uri: "https://github.com",
    });
  });

  it("preserves a password containing a comma", async () => {
    const items = await parse(FIXTURE);
    const google = items[1];
    expect(google).toBeDefined();
    if (!google) return;
    expect(google.data["password"]).toBe("p@ss,word");
  });

  it("passes zod schema validation", async () => {
    const items = await parse(FIXTURE);
    expect(() => parsedItemArraySchema.parse(items)).not.toThrow();
  });
});
