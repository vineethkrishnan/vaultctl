// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  generateRSAKeyPair,
  generateEd25519KeyPair,
  importEd25519PrivateKey,
  importRSAPublicKey,
  ed25519Sign,
  rsaOaepEncrypt,
  aesGcmEncrypt,
  serializeBlob,
  buildWrapSignatureMessage,
  toBase64,
} from "../shared/crypto/index.js";
import type { WorkerResponse } from "./worker-protocol.js";
import type { VaultKeyMaterial } from "./worker-protocol.js";

const USER_ID = "user-abc";
const VAULT_ID = "vault-123";

let responses: WorkerResponse[] = [];
let handle: (e: { data: unknown }) => Promise<void>;

/**
 * The worker is a module with a top-level `self.onmessage`, so drive it by
 * standing in a fake `self` before importing it once.
 */
beforeAll(async () => {
  const fakeSelf = {
    postMessage: (msg: WorkerResponse) => responses.push(msg),
    onmessage: null as unknown,
  };
  (globalThis as unknown as { self: unknown }).self = fakeSelf;
  await import("./crypto-worker.js");
  handle = fakeSelf.onmessage as typeof handle;
});

afterEach(async () => {
  responses = [];
  await handle({ data: { op: "lock" } });
  responses = [];
});

interface Fixture {
  stretchedKey: Uint8Array;
  encryptedPrivateKey: string;
  encryptedIdentityPrivateKey: string;
  publicKey: string;
  vault: VaultKeyMaterial;
}

/**
 * Build a shared vault wrapped to the user and signed by `signer`. Passing a
 * signer other than the declared sender is how the substitution case is built.
 */
async function makeFixture(options?: {
  signerIsSender?: boolean;
}): Promise<Fixture> {
  const stretchedKey = crypto.getRandomValues(new Uint8Array(32));
  const rsa = await generateRSAKeyPair();
  const ownIdentity = await generateEd25519KeyPair();
  const sender = await generateEd25519KeyPair();

  const encPriv = await aesGcmEncrypt(stretchedKey, rsa.privateKey);
  const encIdPriv = await aesGcmEncrypt(stretchedKey, ownIdentity.privateKey);

  const rawVaultKey = crypto.getRandomValues(new Uint8Array(32));
  const rsaPublic = await importRSAPublicKey(rsa.publicKey);
  const wrappedBlob = await rsaOaepEncrypt(rsaPublic, rawVaultKey);
  const encryptedVaultKey = serializeBlob(wrappedBlob);

  const impostor = await generateEd25519KeyPair();
  const signingKey =
    options?.signerIsSender === false ? impostor.privateKey : sender.privateKey;
  const signerPriv = await importEd25519PrivateKey(signingKey);
  const signature = await ed25519Sign(
    signerPriv,
    buildWrapSignatureMessage(VAULT_ID, USER_ID, encryptedVaultKey),
  );

  return {
    stretchedKey,
    encryptedPrivateKey: toBase64(serializeBlob(encPriv)),
    encryptedIdentityPrivateKey: toBase64(serializeBlob(encIdPriv)),
    publicKey: toBase64(rsa.publicKey),
    vault: {
      vaultId: VAULT_ID,
      encryptedVaultKey: toBase64(encryptedVaultKey),
      vaultType: "shared",
      senderId: "user-sender",
      wrapSignature: toBase64(signature),
      senderIdentityPublicKey: toBase64(sender.publicKey),
    },
  };
}

async function init(fixture: Fixture) {
  const sk = fixture.stretchedKey;
  await handle({
    data: {
      op: "init",
      requestId: "r1",
      userId: USER_ID,
      stretchedKey: sk.buffer.slice(sk.byteOffset, sk.byteOffset + sk.byteLength),
      encryptedPrivateKey: fixture.encryptedPrivateKey,
      encryptedIdentityPrivateKey: fixture.encryptedIdentityPrivateKey,
      publicKey: fixture.publicKey,
      vaults: [fixture.vault],
    },
  });
  const done = responses.find((r) => r.op === "initDone");
  expect(done, JSON.stringify(responses)).toBeDefined();
  return done as Extract<WorkerResponse, { op: "initDone" }>;
}

async function canDecryptVault(): Promise<boolean> {
  responses = [];
  await handle({
    data: {
      op: "encrypt",
      requestId: "r2",
      vaultId: VAULT_ID,
      plaintext: new Uint8Array([1, 2, 3]).buffer,
    },
  });
  return responses.some((r) => r.op === "resultString");
}

describe("crypto worker init - wrap signature verification", () => {
  it("loads a shared vault key the named sender signed", async () => {
    const done = await init(await makeFixture());
    expect(done.rejectedVaultIds).toEqual([]);
    expect(await canDecryptVault()).toBe(true);
  });

  it("rejects the vault when the signature is not the sender's, without failing the unlock", async () => {
    const done = await init(await makeFixture({ signerIsSender: false }));
    expect(done.rejectedVaultIds).toEqual([VAULT_ID]);
    // The unlock itself still succeeded - the key is simply absent.
    expect(await canDecryptVault()).toBe(false);
  });
});
