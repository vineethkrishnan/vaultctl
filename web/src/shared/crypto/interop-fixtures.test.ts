// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Interop test fixture generator.
 *
 * Produces JSON fixtures under testdata/ that the Go interop_test.go can read
 * to verify TS-encrypted data decrypts correctly in Go and vice versa.
 *
 * Fixture format:
 *   { key_b64, plaintext_b64, blob_b64, aad_b64? }
 *
 * Run: npx vitest run src/shared/crypto/interop-fixtures.test.ts
 */

import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { aesGcmEncrypt } from "./aes-gcm.js";
import { serializeBlob } from "./blob.js";
import { deriveAuthHash, deriveStretchedKey } from "./hkdf.js";
import { deriveArgon2id } from "./argon2.js";
import { pad, unpad } from "./padding.js";
import { toBase64 } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "../../../../testdata/crypto");

interface AesGcmFixture {
  key_b64: string;
  plaintext_b64: string;
  blob_b64: string;
  aad_b64?: string;
}

interface HkdfFixture {
  master_key_b64: string;
  auth_hash_b64: string;
  stretched_key_b64: string;
}

interface PaddingFixture {
  original_b64: string;
  padded_b64: string;
}

interface Argon2idFixture {
  password: string;
  salt_b64: string;
  iterations: number;
  memory_kb: number;
  parallelism: number;
  master_key_b64: string;
}

const encoder = new TextEncoder();

// Deterministic 16-byte salts so the Argon2id fixture is reproducible across
// regenerations - unlike the random AES-GCM/HKDF fixtures, these vectors are
// the canonical cross-implementation reference (web hash-wasm, Go x/crypto,
// mobile native react-native-argon2 all must reproduce master_key_b64).
function fixedSalt(byte: number): Uint8Array {
  return new Uint8Array(16).fill(byte);
}

describe("interop fixture generation", () => {
  it("generates AES-GCM fixtures", async () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });

    const fixtures: AesGcmFixture[] = [];

    // Fixture 1: simple plaintext, no AAD
    {
      const key = crypto.getRandomValues(new Uint8Array(32));
      const plaintext = encoder.encode("hello from TypeScript");
      const blob = await aesGcmEncrypt(key, plaintext);
      const wire = serializeBlob(blob);

      fixtures.push({
        key_b64: toBase64(key),
        plaintext_b64: toBase64(plaintext),
        blob_b64: toBase64(wire),
      });
    }

    // Fixture 2: with AAD
    {
      const key = crypto.getRandomValues(new Uint8Array(32));
      const plaintext = encoder.encode("secret with AAD");
      const aad = encoder.encode("user:u123:totp_secret");
      const blob = await aesGcmEncrypt(key, plaintext, aad);
      const wire = serializeBlob(blob);

      fixtures.push({
        key_b64: toBase64(key),
        plaintext_b64: toBase64(plaintext),
        blob_b64: toBase64(wire),
        aad_b64: toBase64(aad),
      });
    }

    // Fixture 3: binary data (32 random bytes, like a vault key)
    {
      const key = crypto.getRandomValues(new Uint8Array(32));
      const plaintext = crypto.getRandomValues(new Uint8Array(32));
      const blob = await aesGcmEncrypt(key, plaintext);
      const wire = serializeBlob(blob);

      fixtures.push({
        key_b64: toBase64(key),
        plaintext_b64: toBase64(plaintext),
        blob_b64: toBase64(wire),
      });
    }

    // Fixture 4: padded name (simulates encrypted_name flow)
    {
      const key = crypto.getRandomValues(new Uint8Array(32));
      const name = encoder.encode("My Login Item");
      const padded = pad(name);
      const blob = await aesGcmEncrypt(key, padded);
      const wire = serializeBlob(blob);

      fixtures.push({
        key_b64: toBase64(key),
        plaintext_b64: toBase64(padded), // Go decrypts → padded, then unpads
        blob_b64: toBase64(wire),
      });
    }

    writeFileSync(
      join(FIXTURE_DIR, "aes_gcm_fixtures.json"),
      JSON.stringify(fixtures, null, 2) + "\n",
    );

    expect(fixtures.length).toBe(4);
  });

  it("generates HKDF fixtures", async () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });

    const fixtures: HkdfFixture[] = [];

    // Generate deterministic master keys to test HKDF output
    for (let i = 0; i < 3; i++) {
      const masterKey = crypto.getRandomValues(new Uint8Array(32));
      const authHash = await deriveAuthHash(masterKey);
      const stretchedKey = await deriveStretchedKey(masterKey);

      fixtures.push({
        master_key_b64: toBase64(masterKey),
        auth_hash_b64: toBase64(authHash),
        stretched_key_b64: toBase64(stretchedKey),
      });
    }

    writeFileSync(
      join(FIXTURE_DIR, "hkdf_fixtures.json"),
      JSON.stringify(fixtures, null, 2) + "\n",
    );

    expect(fixtures.length).toBe(3);
  });

  it("generates Argon2id fixtures", async () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });

    const vectors = [
      {
        password: "correct horse battery staple",
        salt: fixedSalt(0x11),
        params: { iterations: 3, memoryKB: 65536, parallelism: 4 },
      },
      {
        password: "hunter2",
        salt: fixedSalt(0x2a),
        params: { iterations: 1, memoryKB: 19456, parallelism: 1 },
      },
    ];

    const fixtures: Argon2idFixture[] = [];
    for (const vector of vectors) {
      const masterKey = await deriveArgon2id(
        vector.password,
        vector.salt,
        vector.params,
      );
      fixtures.push({
        password: vector.password,
        salt_b64: toBase64(vector.salt),
        iterations: vector.params.iterations,
        memory_kb: vector.params.memoryKB,
        parallelism: vector.params.parallelism,
        master_key_b64: toBase64(masterKey),
      });
    }

    writeFileSync(
      join(FIXTURE_DIR, "argon2_fixtures.json"),
      JSON.stringify(fixtures, null, 2) + "\n",
    );

    expect(fixtures.length).toBe(vectors.length);
  });

  it("generates padding fixtures", () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });

    const fixtures: PaddingFixture[] = [];

    const testCases = [
      "",                    // empty → 32 bytes of padding
      "a",                   // 1 byte → 31 bytes padding
      "hello",              // 5 bytes → 27 bytes padding
      "exactly 32 bytes!!!!!!!!!!!!!", // 30 bytes → 2 bytes padding
      "x".repeat(31),       // 31 bytes → 1 byte padding
      "y".repeat(32),       // 32 bytes → 32 bytes padding (full block)
      "z".repeat(33),       // 33 bytes → 31 bytes padding
    ];

    for (const tc of testCases) {
      const original = encoder.encode(tc);
      const padded = pad(original);

      fixtures.push({
        original_b64: toBase64(original),
        padded_b64: toBase64(padded),
      });

      // Verify round-trip
      const rt = unpad(padded);
      expect(rt).toEqual(original);
    }

    writeFileSync(
      join(FIXTURE_DIR, "padding_fixtures.json"),
      JSON.stringify(fixtures, null, 2) + "\n",
    );

    expect(fixtures.length).toBe(testCases.length);
  });
});
