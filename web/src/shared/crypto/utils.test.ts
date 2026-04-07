import { describe, it, expect } from "vitest";
import { zero, timingSafeEqual, concat, toBase64, fromBase64 } from "./utils.js";

describe("zero", () => {
  it("fills buffer with zeros", () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    zero(buf);
    expect(buf).toEqual(new Uint8Array(4));
  });
});

describe("timingSafeEqual", () => {
  it("returns true for equal arrays", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it("returns false for different arrays", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 4]);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it("returns false for different lengths", () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([1, 2, 3]);
    expect(timingSafeEqual(a, b)).toBe(false);
  });
});

describe("concat", () => {
  it("concatenates multiple arrays", () => {
    const result = concat(
      new Uint8Array([1, 2]),
      new Uint8Array([3]),
      new Uint8Array([4, 5, 6]),
    );
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it("handles empty arrays", () => {
    const result = concat(new Uint8Array(0), new Uint8Array([1]));
    expect(result).toEqual(new Uint8Array([1]));
  });
});

describe("toBase64 / fromBase64", () => {
  it("round-trips binary data", () => {
    const data = new Uint8Array([0, 1, 127, 128, 255]);
    const b64 = toBase64(data);
    const decoded = fromBase64(b64);
    expect(decoded).toEqual(data);
  });

  it("produces standard base64 with padding", () => {
    // 3 bytes → 4 chars, no padding
    expect(toBase64(new Uint8Array([1, 2, 3]))).toBe("AQID");
    // 1 byte → 4 chars with == padding
    expect(toBase64(new Uint8Array([1]))).toBe("AQ==");
    // 2 bytes → 4 chars with = padding
    expect(toBase64(new Uint8Array([1, 2]))).toBe("AQI=");
  });

  it("matches Go's base64.StdEncoding output", () => {
    // Known vector: empty
    expect(toBase64(new Uint8Array(0))).toBe("");
    // Known vector: "hello"
    const hello = new TextEncoder().encode("hello");
    expect(toBase64(hello)).toBe("aGVsbG8=");
  });
});
