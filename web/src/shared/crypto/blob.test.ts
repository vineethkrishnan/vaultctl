import { describe, it, expect } from "vitest";
import { AlgID, BLOB_VERSION } from "./algorithm.js";
import {
  type EncryptedBlob,
  MalformedBlobError,
  validateBlob,
  serializeBlob,
  parseBlob,
} from "./blob.js";

describe("serializeBlob / parseBlob round-trip", () => {
  it("round-trips AES-256-GCM blob", () => {
    const blob: EncryptedBlob = {
      version: BLOB_VERSION,
      alg: AlgID.AES_256_GCM,
      nonce: new Uint8Array(12).fill(0xaa),
      ciphertext: new Uint8Array([0x01, 0x02, 0x03]),
      tag: new Uint8Array(16).fill(0xbb),
    };

    const wire = serializeBlob(blob);
    const parsed = parseBlob(wire);

    expect(parsed.version).toBe(blob.version);
    expect(parsed.alg).toBe(blob.alg);
    expect(parsed.nonce).toEqual(blob.nonce);
    expect(parsed.ciphertext).toEqual(blob.ciphertext);
    expect(parsed.tag).toEqual(blob.tag);
  });

  it("round-trips RSA-OAEP blob (no nonce, no tag)", () => {
    const blob: EncryptedBlob = {
      version: BLOB_VERSION,
      alg: AlgID.RSA_OAEP_SHA256,
      nonce: new Uint8Array(0),
      ciphertext: new Uint8Array(256).fill(0xcc),
      tag: new Uint8Array(0),
    };

    const wire = serializeBlob(blob);
    expect(wire.length).toBe(2 + 256);

    const parsed = parseBlob(wire);
    expect(parsed.alg).toBe(AlgID.RSA_OAEP_SHA256);
    expect(parsed.nonce.length).toBe(0);
    expect(parsed.ciphertext).toEqual(blob.ciphertext);
    expect(parsed.tag.length).toBe(0);
  });

  it("round-trips AES-256-KW blob (no nonce, 8-byte tag)", () => {
    const blob: EncryptedBlob = {
      version: BLOB_VERSION,
      alg: AlgID.AES_256_KW,
      nonce: new Uint8Array(0),
      ciphertext: new Uint8Array(40).fill(0xdd),
      tag: new Uint8Array(8).fill(0xee),
    };

    const wire = serializeBlob(blob);
    const parsed = parseBlob(wire);

    expect(parsed.alg).toBe(AlgID.AES_256_KW);
    expect(parsed.nonce.length).toBe(0);
    expect(parsed.ciphertext).toEqual(blob.ciphertext);
    expect(parsed.tag).toEqual(blob.tag);
  });
});

describe("wire format byte layout", () => {
  it("AES-GCM: version(1) + alg(1) + nonce(12) + ct(N) + tag(16)", () => {
    const blob: EncryptedBlob = {
      version: BLOB_VERSION,
      alg: AlgID.AES_256_GCM,
      nonce: new Uint8Array(12).fill(0x11),
      ciphertext: new Uint8Array([0x42, 0x43]),
      tag: new Uint8Array(16).fill(0x22),
    };

    const wire = serializeBlob(blob);
    expect(wire.length).toBe(2 + 12 + 2 + 16);
    expect(wire[0]).toBe(0x01); // version
    expect(wire[1]).toBe(0x01); // alg
    expect(wire[2]).toBe(0x11); // nonce start
    expect(wire[14]).toBe(0x42); // ciphertext start
    expect(wire[16]).toBe(0x22); // tag start
  });
});

describe("parseBlob error cases", () => {
  it("rejects empty input", () => {
    expect(() => parseBlob(new Uint8Array(0))).toThrow(MalformedBlobError);
  });

  it("rejects single byte", () => {
    expect(() => parseBlob(new Uint8Array([0x01]))).toThrow(MalformedBlobError);
  });

  it("rejects unknown version", () => {
    expect(() => parseBlob(new Uint8Array([0x02, 0x01]))).toThrow(
      /unsupported version/,
    );
  });

  it("rejects unknown alg", () => {
    expect(() => parseBlob(new Uint8Array([0x01, 0xff]))).toThrow(
      /unknown alg/,
    );
  });

  it("rejects body too short for AES-GCM (need 12+16+1 = 29 body bytes)", () => {
    const short = new Uint8Array(2 + 12 + 16); // missing ciphertext
    short[0] = 0x01;
    short[1] = 0x01;
    expect(() => parseBlob(short)).toThrow(/empty ciphertext/);
  });
});

describe("validateBlob", () => {
  it("rejects wrong nonce size for AES-GCM", () => {
    const blob: EncryptedBlob = {
      version: BLOB_VERSION,
      alg: AlgID.AES_256_GCM,
      nonce: new Uint8Array(8), // wrong, should be 12
      ciphertext: new Uint8Array([1]),
      tag: new Uint8Array(16),
    };
    expect(() => validateBlob(blob)).toThrow(/nonce len/);
  });

  it("rejects wrong tag size for AES-GCM", () => {
    const blob: EncryptedBlob = {
      version: BLOB_VERSION,
      alg: AlgID.AES_256_GCM,
      nonce: new Uint8Array(12),
      ciphertext: new Uint8Array([1]),
      tag: new Uint8Array(8), // wrong, should be 16
    };
    expect(() => validateBlob(blob)).toThrow(/tag len/);
  });
});
