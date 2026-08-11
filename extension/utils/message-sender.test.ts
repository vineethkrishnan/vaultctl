// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { isContentScriptSender } from "./message-sender";

const BASE = "chrome-extension://abcdefghijklmnop/";

describe("isContentScriptSender", () => {
  it("treats the toolbar popup (no tab) as an extension page", () => {
    expect(isContentScriptSender(`${BASE}popup.html`, false, BASE)).toBe(false);
    expect(isContentScriptSender(undefined, false, BASE)).toBe(false);
  });

  it("treats a windows.create popup (tab + extension url) as an extension page", () => {
    expect(isContentScriptSender(`${BASE}popup.html`, true, BASE)).toBe(false);
  });

  it("treats a web page sender (tab + http url) as a content script", () => {
    expect(
      isContentScriptSender("https://example.com/login", true, BASE),
    ).toBe(true);
  });

  it("fails closed when a tab sender has no url", () => {
    expect(isContentScriptSender(undefined, true, BASE)).toBe(true);
  });

  it("is not fooled by a lookalike https host", () => {
    expect(
      isContentScriptSender(
        "https://chrome-extension.example.com/abcdefghijklmnop/",
        true,
        BASE,
      ),
    ).toBe(true);
  });

  it("keeps a different extension's url classified as a content script", () => {
    expect(
      isContentScriptSender(
        "chrome-extension://zzzzzzzzzzzzzzzz/popup.html",
        true,
        BASE,
      ),
    ).toBe(true);
  });
});
