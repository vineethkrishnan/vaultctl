import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "./onepassword-csv.js";
import { parsedItemArraySchema } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, "__fixtures__/onepassword-legacy.csv"), "utf8");

describe("onepassword-csv (legacy)", () => {
  it("parses the fixture into three items", async () => {
    const items = await parse(FIXTURE);
    expect(items).toHaveLength(3);
  });

  it("classifies credential rows as login and empty-credentials as secure note", async () => {
    const items = await parse(FIXTURE);
    expect(items.map((item) => item.type)).toEqual(["login", "login", "secure_note"]);
  });

  it("decodes the first login's title, username, password and url", async () => {
    const items = await parse(FIXTURE);
    const github = items[0];
    expect(github).toBeDefined();
    if (!github) return;
    expect(github.name).toBe("GitHub");
    expect(github.data).toMatchObject({
      username: "octocat",
      password: "hunter2",
      uri: "https://github.com",
      notes: "Personal account",
    });
  });

  it("captures OTPAuth as the totp value on the Gmail row", async () => {
    const items = await parse(FIXTURE);
    const gmail = items[1];
    expect(gmail).toBeDefined();
    if (!gmail) return;
    expect(gmail.data["totp"]).toBe("otpauth://totp/example");
  });

  it("maps the credential-less row to a secure note", async () => {
    const items = await parse(FIXTURE);
    const note = items[2];
    expect(note).toBeDefined();
    if (!note) return;
    expect(note.type).toBe("secure_note");
    expect(note.name).toBe("Router Admin");
    expect(note.data["content"]).toContain("rotate quarterly");
  });

  it("passes zod validation", async () => {
    const items = await parse(FIXTURE);
    expect(() => parsedItemArraySchema.parse(items)).not.toThrow();
  });
});
