// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import {
  buildSignedEnvelope,
  verifyEnvelope,
  EnvelopeError,
  EnvelopeSignatureError,
  EnvelopeUserMismatchError,
  EnvelopeVersionError,
  EXPORT_ENVELOPE_VERSION,
  type ExportEnvelopeBody,
} from "./envelope.js";
import { generateEd25519KeyPair } from "../crypto/ed25519.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const fixtureBody = (): Omit<ExportEnvelopeBody, "version"> => ({
  createdAt: "2026-04-11T14:03:00Z",
  userId: "u-1234",
  vaults: [
    {
      id: "v-1",
      name: "Personal",
      type: "personal",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
  items: [
    {
      id: "i-1",
      vaultId: "v-1",
      itemType: "login",
      encryptedData: "dGVzdA==",
      encryptedName: "bmFtZQ==",
      favorite: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "i-2",
      vaultId: "v-1",
      folderId: "f-1",
      itemType: "secure_note",
      encryptedData: "YW5vdGhlcg==",
      encryptedName: "bmFtZTI=",
      favorite: true,
      createdAt: "2026-01-02T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    },
  ],
  folders: [
    {
      id: "f-1",
      vaultId: "v-1",
      encryptedName: "Zm9sZGVy",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("buildSignedEnvelope + verifyEnvelope", () => {
  it("signs and verifies a round-trip", async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const body = fixtureBody();

    const signed = await buildSignedEnvelope(body, privateKey);
    const verified = await verifyEnvelope(signed, body.userId, publicKey);

    expect(verified.version).toBe(EXPORT_ENVELOPE_VERSION);
    expect(verified.userId).toBe(body.userId);
    expect(verified.items).toHaveLength(2);
    expect(verified.items[0]?.id).toBe("i-1");
    expect(verified.items[1]?.folderId).toBe("f-1");
  });

  it("produces valid JSON that parses to the expected envelope shape", async () => {
    const { privateKey } = await generateEd25519KeyPair();
    const signed = await buildSignedEnvelope(fixtureBody(), privateKey);
    const text = new TextDecoder().decode(signed);
    const parsed = JSON.parse(text);

    expect(parsed.version).toBe(EXPORT_ENVELOPE_VERSION);
    expect(typeof parsed.envelopeMac).toBe("string");
    expect(parsed.envelopeMac.length).toBeGreaterThan(40); // base64 Ed25519 sig
    expect(parsed.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tampering — the critical M6-hardening acceptance test
// ---------------------------------------------------------------------------

describe("tamper detection", () => {
  it("rejects a mutated item ciphertext byte", async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const body = fixtureBody();
    const signed = await buildSignedEnvelope(body, privateKey);

    const parsed = JSON.parse(new TextDecoder().decode(signed));
    // Flip one character inside the base64 ciphertext of the first item.
    parsed.items[0].encryptedData = "XXXXXX==";
    const tampered = new TextEncoder().encode(JSON.stringify(parsed));

    await expect(
      verifyEnvelope(tampered, body.userId, publicKey),
    ).rejects.toBeInstanceOf(EnvelopeSignatureError);
  });

  it("rejects a mutated item name", async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const body = fixtureBody();
    const signed = await buildSignedEnvelope(body, privateKey);

    const parsed = JSON.parse(new TextDecoder().decode(signed));
    parsed.items[0].encryptedName = parsed.items[0].encryptedName + "!";
    const tampered = new TextEncoder().encode(JSON.stringify(parsed));

    await expect(
      verifyEnvelope(tampered, body.userId, publicKey),
    ).rejects.toBeInstanceOf(EnvelopeSignatureError);
  });

  it("rejects an item added after signing", async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const body = fixtureBody();
    const signed = await buildSignedEnvelope(body, privateKey);

    const parsed = JSON.parse(new TextDecoder().decode(signed));
    parsed.items.push({
      id: "i-injected",
      vaultId: "v-1",
      itemType: "login",
      encryptedData: "aGFjaw==",
      encryptedName: "aGFjaw==",
      favorite: false,
      createdAt: "2026-01-03T00:00:00Z",
      updatedAt: "2026-01-03T00:00:00Z",
    });
    const tampered = new TextEncoder().encode(JSON.stringify(parsed));

    await expect(
      verifyEnvelope(tampered, body.userId, publicKey),
    ).rejects.toBeInstanceOf(EnvelopeSignatureError);
  });

  it("rejects an item removed after signing", async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const body = fixtureBody();
    const signed = await buildSignedEnvelope(body, privateKey);

    const parsed = JSON.parse(new TextDecoder().decode(signed));
    parsed.items.pop();
    const tampered = new TextEncoder().encode(JSON.stringify(parsed));

    await expect(
      verifyEnvelope(tampered, body.userId, publicKey),
    ).rejects.toBeInstanceOf(EnvelopeSignatureError);
  });

  it("rejects a bit-flipped signature", async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const body = fixtureBody();
    const signed = await buildSignedEnvelope(body, privateKey);

    const parsed = JSON.parse(new TextDecoder().decode(signed));
    // Flip one base64 char in envelope_mac, keeping it valid base64.
    const first = parsed.envelopeMac[0] === "A" ? "B" : "A";
    parsed.envelopeMac = first + parsed.envelopeMac.slice(1);
    const tampered = new TextEncoder().encode(JSON.stringify(parsed));

    await expect(
      verifyEnvelope(tampered, body.userId, publicKey),
    ).rejects.toBeInstanceOf(EnvelopeSignatureError);
  });
});

// ---------------------------------------------------------------------------
// Replay / wrong key / wrong user
// ---------------------------------------------------------------------------

describe("cross-account + wrong-key rejection", () => {
  it("rejects a valid envelope from user A when user B tries to import it", async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const body = fixtureBody();
    const signed = await buildSignedEnvelope(body, privateKey);

    await expect(
      verifyEnvelope(signed, "u-different", publicKey),
    ).rejects.toBeInstanceOf(EnvelopeUserMismatchError);
  });

  it("rejects an envelope whose signature was produced with a different key", async () => {
    const a = await generateEd25519KeyPair();
    const b = await generateEd25519KeyPair();
    const body = fixtureBody();

    // Sign with A's private key, verify with B's public key.
    const signed = await buildSignedEnvelope(body, a.privateKey);

    await expect(
      verifyEnvelope(signed, body.userId, b.publicKey),
    ).rejects.toBeInstanceOf(EnvelopeSignatureError);
  });
});

// ---------------------------------------------------------------------------
// Structural rejection
// ---------------------------------------------------------------------------

describe("structural rejection", () => {
  it("rejects malformed JSON", async () => {
    const { publicKey } = await generateEd25519KeyPair();
    await expect(
      verifyEnvelope("not json {{{", "u-1234", publicKey),
    ).rejects.toBeInstanceOf(EnvelopeError);
  });

  it("rejects envelopes missing required fields", async () => {
    const { publicKey } = await generateEd25519KeyPair();
    const raw = new TextEncoder().encode(
      JSON.stringify({ version: 1, userId: "u-1234" }),
    );
    await expect(
      verifyEnvelope(raw, "u-1234", publicKey),
    ).rejects.toBeInstanceOf(EnvelopeError);
  });

  it("rejects a future envelope version", async () => {
    const { publicKey, privateKey } = await generateEd25519KeyPair();
    const body = fixtureBody();
    const signed = await buildSignedEnvelope(body, privateKey);

    const parsed = JSON.parse(new TextDecoder().decode(signed));
    parsed.version = EXPORT_ENVELOPE_VERSION + 1;
    const bumped = new TextEncoder().encode(JSON.stringify(parsed));

    await expect(
      verifyEnvelope(bumped, body.userId, publicKey),
    ).rejects.toBeInstanceOf(EnvelopeVersionError);
  });
});
