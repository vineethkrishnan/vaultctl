import { describe, it, expect } from "vitest";
import { AlgID, KEY_SIZE_256 } from "./algorithm.js";
import {
  generateRSAKeyPair,
  importRSAPublicKey,
  importRSAPrivateKey,
  rsaOaepEncrypt,
  rsaOaepDecrypt,
} from "./rsa-oaep.js";
import { serializeBlob, parseBlob } from "./blob.js";

describe("RSA-OAEP", () => {
  it("generates a valid keypair", async () => {
    const kp = await generateRSAKeyPair();
    expect(kp.publicKey.length).toBeGreaterThan(200); // SPKI DER ~294 bytes
    expect(kp.privateKey.length).toBeGreaterThan(1000); // PKCS#8 DER ~1218 bytes
  });

  it("round-trips vault key encryption", async () => {
    const kp = await generateRSAKeyPair();
    const pubKey = await importRSAPublicKey(kp.publicKey);
    const privKey = await importRSAPrivateKey(kp.privateKey);

    const vaultKey = crypto.getRandomValues(new Uint8Array(KEY_SIZE_256));
    const blob = await rsaOaepEncrypt(pubKey, vaultKey);

    expect(blob.alg).toBe(AlgID.RSA_OAEP_SHA256);
    expect(blob.nonce.length).toBe(0);
    expect(blob.tag.length).toBe(0);
    expect(blob.ciphertext.length).toBe(256); // RSA-2048 = 256 bytes output

    const decrypted = await rsaOaepDecrypt(privKey, blob);
    expect(decrypted).toEqual(vaultKey);
  });

  it("serializes through wire format", async () => {
    const kp = await generateRSAKeyPair();
    const pubKey = await importRSAPublicKey(kp.publicKey);
    const privKey = await importRSAPrivateKey(kp.privateKey);

    const vaultKey = crypto.getRandomValues(new Uint8Array(KEY_SIZE_256));
    const blob = await rsaOaepEncrypt(pubKey, vaultKey);
    const wire = serializeBlob(blob);

    // Wire: version(1) + alg(1) + ciphertext(256) = 258
    expect(wire.length).toBe(258);
    expect(wire[0]).toBe(0x01); // version
    expect(wire[1]).toBe(0x02); // alg=RSA-OAEP

    const parsed = parseBlob(wire);
    const decrypted = await rsaOaepDecrypt(privKey, parsed);
    expect(decrypted).toEqual(vaultKey);
  });

  it("fails to decrypt with wrong private key", async () => {
    const kp1 = await generateRSAKeyPair();
    const kp2 = await generateRSAKeyPair();
    const pubKey = await importRSAPublicKey(kp1.publicKey);
    const privKey2 = await importRSAPrivateKey(kp2.privateKey);

    const vaultKey = crypto.getRandomValues(new Uint8Array(KEY_SIZE_256));
    const blob = await rsaOaepEncrypt(pubKey, vaultKey);

    await expect(rsaOaepDecrypt(privKey2, blob)).rejects.toThrow();
  });
});
