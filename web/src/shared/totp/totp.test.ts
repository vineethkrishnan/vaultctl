// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  decodeBase32,
  generateTotpAt,
  parseTotp,
  secondsRemaining,
  type TotpParams,
} from "./totp.js";

// RFC 6238 Appendix B uses the ASCII seed "12345678901234567890" (20 bytes).
// In base32 that is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
const RFC_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

function sha1Params(): TotpParams {
  return {
    secret: decodeBase32(RFC_SECRET_BASE32),
    digits: 8,
    period: 30,
    algorithm: "SHA1",
  };
}

describe("decodeBase32", () => {
  it("decodes the RFC seed to the ASCII bytes", () => {
    const bytes = decodeBase32(RFC_SECRET_BASE32);
    expect(new TextDecoder().decode(bytes)).toBe("12345678901234567890");
  });

  it("ignores padding, whitespace and lowercase", () => {
    const a = decodeBase32("jbsw y3dp ehpk 3pxp");
    const b = decodeBase32("JBSWY3DPEHPK3PXP");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("rejects invalid characters", () => {
    expect(() => decodeBase32("0189!")).toThrow();
  });
});

describe("generateTotpAt (RFC 6238 SHA1 vectors)", () => {
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ];

  for (const [time, expected] of vectors) {
    it(`T=${time} -> ${expected}`, async () => {
      expect(await generateTotpAt(sha1Params(), time)).toBe(expected);
    });
  }
});

describe("parseTotp", () => {
  it("parses a bare base32 secret with defaults", () => {
    const params = parseTotp("JBSWY3DPEHPK3PXP");
    expect(params.digits).toBe(6);
    expect(params.period).toBe(30);
    expect(params.algorithm).toBe("SHA1");
  });

  it("parses an otpauth URI and honours its params", () => {
    const uri =
      "otpauth://totp/Example:alice@example.com?secret=" +
      RFC_SECRET_BASE32 +
      "&issuer=Example&digits=8&period=60&algorithm=SHA256";
    const params = parseTotp(uri);
    expect(params.digits).toBe(8);
    expect(params.period).toBe(60);
    expect(params.algorithm).toBe("SHA256");
  });

  it("produces the RFC code from an otpauth URI", async () => {
    const uri = `otpauth://totp/x?secret=${RFC_SECRET_BASE32}&digits=8`;
    expect(await generateTotpAt(parseTotp(uri), 59)).toBe("94287082");
  });

  it("throws on an empty value", () => {
    expect(() => parseTotp("   ")).toThrow();
  });
});

describe("secondsRemaining", () => {
  it("counts down within a 30s window", () => {
    expect(secondsRemaining(30, 0)).toBe(30);
    expect(secondsRemaining(30, 1)).toBe(29);
    expect(secondsRemaining(30, 29)).toBe(1);
    expect(secondsRemaining(30, 30)).toBe(30);
  });
});
