// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bitwarden CSV parser tests, including the round-trip integrity test that
 * verifies parse → serialize → parse yields the same ParsedItem array.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parse,
  parseBitwardenCSV,
  serializeBitwardenCSV,
} from "./bitwarden-csv.js";
import { parsedItemArraySchema } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, "__fixtures__/bitwarden.csv"), "utf8");

describe("bitwarden-csv", () => {
  it("parses the golden fixture into three items", async () => {
    const items = await parse(FIXTURE);
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.type)).toEqual(["login", "login", "secure_note"]);
  });

  it("decodes the first login row's fields", async () => {
    const items = await parse(FIXTURE);
    const github = items[0];
    expect(github).toBeDefined();
    if (!github) return;
    expect(github.name).toBe("GitHub");
    expect(github.type).toBe("login");
    expect(github.data).toMatchObject({
      username: "octocat",
      password: "hunter2",
      uri: "https://github.com",
      notes: "my work notes, with a comma",
    });
  });

  it("preserves embedded newlines in secure note content", async () => {
    const items = await parse(FIXTURE);
    const note = items[2];
    expect(note).toBeDefined();
    if (!note) return;
    expect(note.type).toBe("secure_note");
    expect(note.name).toBe("Recovery Codes");
    expect(note.data["content"]).toBe("line one\nline two\nline three");
  });

  it("passes zod validation via parsedItemArraySchema", async () => {
    const items = await parse(FIXTURE);
    expect(() => parsedItemArraySchema.parse(items)).not.toThrow();
  });

  it("round-trips parse → serialize → parse", () => {
    const first = parseBitwardenCSV(FIXTURE);
    const serialized = serializeBitwardenCSV(first);
    const second = parseBitwardenCSV(serialized);
    expect(second).toEqual(first);
  });
});
