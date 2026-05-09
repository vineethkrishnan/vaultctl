// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "./lastpass-csv.js";
import { parsedItemArraySchema } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, "__fixtures__/lastpass.csv"), "utf8");

describe("lastpass-csv", () => {
  it("parses all three rows", async () => {
    const items = await parse(FIXTURE);
    expect(items).toHaveLength(3);
  });

  it("emits logins for normal entries and secure notes for http://sn rows", async () => {
    const items = await parse(FIXTURE);
    expect(items.map((item) => item.type)).toEqual([
      "login",
      "login",
      "secure_note",
    ]);
  });

  it("decodes the first login's credentials and notes", async () => {
    const items = await parse(FIXTURE);
    const github = items[0];
    expect(github).toBeDefined();
    if (!github) return;
    expect(github.name).toBe("GitHub");
    expect(github.data).toMatchObject({
      username: "octocat",
      password: "hunter2",
      uri: "https://github.com",
      notes: "Primary GitHub account",
    });
  });

  it("captures totp on the AWS row", async () => {
    const items = await parse(FIXTURE);
    const aws = items[1];
    expect(aws).toBeDefined();
    if (!aws) return;
    expect(aws.data["totp"]).toBe("otpauth://totp/aws");
  });

  it("secure note preserves multi-line extra column", async () => {
    const items = await parse(FIXTURE);
    const note = items[2];
    expect(note).toBeDefined();
    if (!note) return;
    expect(note.type).toBe("secure_note");
    expect(note.name).toBe("Dotfile Notes");
    expect(note.data["content"]).toContain("export PATH");
    expect(note.data["content"]).toContain("alias ll");
  });

  it("passes zod schema validation", async () => {
    const items = await parse(FIXTURE);
    expect(() => parsedItemArraySchema.parse(items)).not.toThrow();
  });
});
