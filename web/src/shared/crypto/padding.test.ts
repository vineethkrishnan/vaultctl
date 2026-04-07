import { describe, it, expect } from "vitest";
import { pad, unpad } from "./padding.js";

const encoder = new TextEncoder();

describe("pad / unpad", () => {
  it("pads to next 32-byte boundary", () => {
    const input = new Uint8Array(10);
    const padded = pad(input);
    expect(padded.length).toBe(32); // 10 + 22 padding
    expect(padded[31]).toBe(22); // padding byte = pad length
  });

  it("adds full block when already aligned", () => {
    const input = new Uint8Array(32);
    const padded = pad(input);
    expect(padded.length).toBe(64); // 32 + 32 full padding block
    expect(padded[63]).toBe(32);
  });

  it("round-trips through pad/unpad", () => {
    const original = encoder.encode("hello");
    const padded = pad(original);
    const unpadded = unpad(padded);
    expect(unpadded).toEqual(original);
  });

  it("round-trips various lengths", () => {
    for (let len = 0; len <= 100; len++) {
      const data = new Uint8Array(len).fill(0x42);
      const rt = unpad(pad(data));
      expect(rt).toEqual(data);
    }
  });

  it("padded length is always multiple of 32", () => {
    for (let len = 0; len <= 100; len++) {
      const padded = pad(new Uint8Array(len));
      expect(padded.length % 32).toBe(0);
    }
  });

  it("all padding bytes have the correct value", () => {
    const input = new Uint8Array(20);
    const padded = pad(input);
    const padLen = 12; // 32 - 20
    for (let i = 20; i < 32; i++) {
      expect(padded[i]).toBe(padLen);
    }
  });
});

describe("unpad error cases", () => {
  it("rejects empty input", () => {
    expect(() => unpad(new Uint8Array(0))).toThrow(/invalid padded length/);
  });

  it("rejects non-multiple of 32", () => {
    expect(() => unpad(new Uint8Array(31))).toThrow(/invalid padded length/);
  });

  it("rejects inconsistent padding bytes", () => {
    const bad = new Uint8Array(32);
    bad[31] = 5;
    bad[30] = 5;
    bad[29] = 5;
    bad[28] = 5;
    bad[27] = 99; // should be 5
    expect(() => unpad(bad)).toThrow(/inconsistent pad bytes/);
  });

  it("rejects zero pad byte", () => {
    const bad = new Uint8Array(32);
    bad[31] = 0;
    expect(() => unpad(bad)).toThrow(/invalid pad byte/);
  });
});
