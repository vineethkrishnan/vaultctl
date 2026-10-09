// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { canAdminister } from "./roles.js";

describe("canAdminister", () => {
  it.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
    ["", false],
    [null, false],
  ])("role %j -> %j", (role, expected) => {
    expect(canAdminister(role)).toBe(expected);
  });
});
