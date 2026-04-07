import { describe, it, expect } from "vitest";
import {
  BLOB_VERSION,
  AlgID,
  isValidAlgId,
  nonceSize,
  tagSize,
  KEY_SIZE_256,
  ED25519_SIGNATURE_SIZE,
} from "./algorithm.js";

describe("algorithm constants", () => {
  it("blob version is 0x01", () => {
    expect(BLOB_VERSION).toBe(0x01);
  });

  it("AlgID values match Go backend", () => {
    expect(AlgID.AES_256_GCM).toBe(0x01);
    expect(AlgID.RSA_OAEP_SHA256).toBe(0x02);
    expect(AlgID.AES_256_KW).toBe(0x03);
  });

  it("key size is 32 bytes", () => {
    expect(KEY_SIZE_256).toBe(32);
  });

  it("Ed25519 signature is 64 bytes", () => {
    expect(ED25519_SIGNATURE_SIZE).toBe(64);
  });
});

describe("isValidAlgId", () => {
  it("accepts valid IDs", () => {
    expect(isValidAlgId(0x01)).toBe(true);
    expect(isValidAlgId(0x02)).toBe(true);
    expect(isValidAlgId(0x03)).toBe(true);
  });

  it("rejects invalid IDs", () => {
    expect(isValidAlgId(0x00)).toBe(false);
    expect(isValidAlgId(0x04)).toBe(false);
    expect(isValidAlgId(0xff)).toBe(false);
  });
});

describe("nonceSize", () => {
  it("AES-256-GCM → 12", () => {
    expect(nonceSize(AlgID.AES_256_GCM)).toBe(12);
  });

  it("RSA-OAEP → 0", () => {
    expect(nonceSize(AlgID.RSA_OAEP_SHA256)).toBe(0);
  });

  it("AES-256-KW → 0", () => {
    expect(nonceSize(AlgID.AES_256_KW)).toBe(0);
  });
});

describe("tagSize", () => {
  it("AES-256-GCM → 16", () => {
    expect(tagSize(AlgID.AES_256_GCM)).toBe(16);
  });

  it("RSA-OAEP → 0", () => {
    expect(tagSize(AlgID.RSA_OAEP_SHA256)).toBe(0);
  });

  it("AES-256-KW → 8", () => {
    expect(tagSize(AlgID.AES_256_KW)).toBe(8);
  });
});
