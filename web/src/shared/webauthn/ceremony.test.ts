// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * End-to-end check of the bytes an authenticator puts on the wire.
 *
 * The relying-party half is done with node:crypto rather than the encoders
 * under test, so a mistake in the DER or COSE output cannot cancel itself out.
 */

import { createPublicKey, verify as nodeVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { concat, sha256 } from "../crypto/utils.js";
import { VAULTCTL_AAGUID } from "./aaguid.js";
import {
  buildAuthenticatorData,
  FLAG_BACKED_UP,
  FLAG_BACKUP_ELIGIBLE,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
} from "./authdata.js";
import { toBase64Url } from "./base64url.js";
import { encodeCbor, type CborValue } from "./cbor.js";
import { toCoseKey } from "./cose.js";
import { generateP256KeyPair, importP256PrivateKey, p256Sign } from "./p256.js";

const RP_ID = "webauthn.io";
const ORIGIN = "https://webauthn.io";
const FLAGS =
  FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP;

/** Recover the COSE key an RP would read out of attested credential data. */
function coseKeyFromAuthData(authData: Uint8Array): Uint8Array {
  const credentialIdLength = (authData[53]! << 8) | authData[54]!;
  return authData.subarray(55 + credentialIdLength);
}

/** Rebuild the public key from the COSE coordinates, as an RP does. */
function publicKeyFromCoseKey(coseKey: Uint8Array) {
  const x = coseKey.subarray(10, 42);
  const y = coseKey.subarray(45, 77);
  return createPublicKey({
    key: { kty: "EC", crv: "P-256", x: toBase64Url(x), y: toBase64Url(y) },
    format: "jwk",
  });
}

describe("registration then authentication", () => {
  it("produces an assertion the relying party can verify", async () => {
    const keyPair = await generateP256KeyPair();
    const credentialId = crypto.getRandomValues(new Uint8Array(32));

    const attestationAuthData = await buildAuthenticatorData({
      rpId: RP_ID,
      flags: FLAGS,
      attestedCredential: {
        aaguid: VAULTCTL_AAGUID,
        credentialId,
        coseKey: toCoseKey(keyPair.coordinates),
      },
    });

    const attestationObject = encodeCbor(
      new Map<number | string, CborValue>([
        ["fmt", "none"],
        ["attStmt", new Map<number | string, CborValue>()],
        ["authData", attestationAuthData],
      ]),
    );
    // a3 | "fmt":"none" | "attStmt":{} | "authData":bytes(len)
    expect([...attestationObject.subarray(0, 1)]).toEqual([0xa3]);
    expect(attestationObject.subarray(-attestationAuthData.length)).toEqual(
      attestationAuthData,
    );

    const relyingPartyKey = publicKeyFromCoseKey(
      coseKeyFromAuthData(attestationAuthData),
    );

    const assertionAuthData = await buildAuthenticatorData({
      rpId: RP_ID,
      flags: FLAGS,
    });
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: "webauthn.get",
        challenge: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
        origin: ORIGIN,
        crossOrigin: false,
      }),
    );
    const signedData = concat(
      assertionAuthData,
      await sha256(clientDataJSON),
    );

    const signature = await p256Sign(
      await importP256PrivateKey(keyPair.privateKey),
      signedData,
    );

    expect(nodeVerify("sha256", signedData, relyingPartyKey, signature)).toBe(
      true,
    );
  });

  it("rejects a signature over different data", async () => {
    const keyPair = await generateP256KeyPair();
    const relyingPartyKey = publicKeyFromCoseKey(toCoseKey(keyPair.coordinates));

    const signedData = new TextEncoder().encode("the real challenge");
    const signature = await p256Sign(
      await importP256PrivateKey(keyPair.privateKey),
      signedData,
    );

    expect(
      nodeVerify(
        "sha256",
        new TextEncoder().encode("a different challenge"),
        relyingPartyKey,
        signature,
      ),
    ).toBe(false);
  });

  it("survives many signatures, including ones needing DER padding", async () => {
    const keyPair = await generateP256KeyPair();
    const relyingPartyKey = publicKeyFromCoseKey(toCoseKey(keyPair.coordinates));
    const privateKey = await importP256PrivateKey(keyPair.privateKey);

    for (let attempt = 0; attempt < 50; attempt++) {
      const signedData = crypto.getRandomValues(new Uint8Array(64));
      const signature = await p256Sign(privateKey, signedData);
      expect(nodeVerify("sha256", signedData, relyingPartyKey, signature)).toBe(
        true,
      );
    }
  });
});
