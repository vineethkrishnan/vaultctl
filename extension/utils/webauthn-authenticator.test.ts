// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPublicKey, verify as nodeVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "@shared/webauthn";
import {
  createCredential,
  selectCredentials,
  signAssertion,
  type CreationRequest,
  type StoredPasskey,
} from "./webauthn-authenticator";

const REQUEST: CreationRequest = {
  rpId: "webauthn.io",
  rpName: "webauthn.io",
  origin: "https://webauthn.io",
  challenge: "Y2hhbGxlbmdl",
  userHandle: "dXNlci1oYW5kbGU",
  userName: "alex@example.com",
  userDisplayName: "Alex",
  discoverable: true,
};

/** Rebuild the public key from the stored SPKI, as a relying party would. */
function relyingPartyKey(passkey: StoredPasskey) {
  return createPublicKey({
    key: Buffer.from(fromBase64Url(passkey.publicKey)),
    format: "der",
    type: "spki",
  });
}

function decodeClientData(base64url: string) {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(base64url)));
}

describe("createCredential", () => {
  it("returns a passkey carrying its own private key", async () => {
    const { passkey } = await createCredential(REQUEST);

    expect(passkey.rpId).toBe("webauthn.io");
    expect(passkey.userName).toBe("alex@example.com");
    expect(passkey.privateKey).not.toBe("");
    expect(passkey.algorithm).toBe(-7);
    expect(fromBase64Url(passkey.credentialId)).toHaveLength(32);
    expect(Date.parse(passkey.createdAt)).not.toBeNaN();
  });

  it("binds the client data to the challenge and origin", async () => {
    const { attestation } = await createCredential(REQUEST);
    const clientData = decodeClientData(attestation.clientDataJSON);

    expect(clientData).toEqual({
      type: "webauthn.create",
      challenge: "Y2hhbGxlbmdl",
      origin: "https://webauthn.io",
      crossOrigin: false,
    });
  });

  it("issues a distinct credential id and key each time", async () => {
    const first = await createCredential(REQUEST);
    const second = await createCredential(REQUEST);

    expect(first.passkey.credentialId).not.toBe(second.passkey.credentialId);
    expect(first.passkey.privateKey).not.toBe(second.passkey.privateKey);
  });
});

describe("signAssertion", () => {
  it("produces a signature the relying party verifies", async () => {
    const { passkey } = await createCredential(REQUEST);
    const assertion = await signAssertion(
      {
        rpId: "webauthn.io",
        origin: "https://webauthn.io",
        challenge: "YW5vdGhlci1jaGFsbGVuZ2U",
      },
      passkey,
    );

    const signedData = Buffer.concat([
      Buffer.from(fromBase64Url(assertion.authenticatorData)),
      Buffer.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            fromBase64Url(assertion.clientDataJSON) as unknown as BufferSource,
          ),
        ),
      ),
    ]);

    expect(
      nodeVerify(
        "sha256",
        signedData,
        relyingPartyKey(passkey),
        Buffer.from(fromBase64Url(assertion.signature)),
      ),
    ).toBe(true);
    expect(assertion.userHandle).toBe("dXNlci1oYW5kbGU");
    expect(assertion.credentialId).toBe(passkey.credentialId);
    expect(decodeClientData(assertion.clientDataJSON).type).toBe("webauthn.get");
  });

  it("omits attested credential data, so the assertion is 37 bytes", async () => {
    const { passkey } = await createCredential(REQUEST);
    const assertion = await signAssertion(
      { rpId: "webauthn.io", origin: "https://webauthn.io", challenge: "eA" },
      passkey,
    );

    expect(fromBase64Url(assertion.authenticatorData)).toHaveLength(37);
  });
});

describe("selectCredentials", () => {
  const make = (rpId: string, credentialId: string, privateKey = "key") =>
    ({ rpId, credentialId, privateKey }) as StoredPasskey;

  const passkeys = [
    make("webauthn.io", "aaa"),
    make("webauthn.io", "bbb"),
    make("example.com", "ccc"),
  ];

  it("returns every credential for the rpId when none are named", () => {
    expect(
      selectCredentials(passkeys, "webauthn.io", []).map((p) => p.credentialId),
    ).toEqual(["aaa", "bbb"]);
  });

  it("narrows to the relying party's allowCredentials list", () => {
    expect(
      selectCredentials(passkeys, "webauthn.io", ["bbb", "zzz"]).map(
        (p) => p.credentialId,
      ),
    ).toEqual(["bbb"]);
  });

  it("never crosses relying parties", () => {
    expect(selectCredentials(passkeys, "evil.com", [])).toEqual([]);
    expect(selectCredentials(passkeys, "webauthn.io", ["ccc"])).toEqual([]);
  });

  it("skips record-only passkeys that carry no private key", () => {
    const recordOnly = [make("webauthn.io", "ddd", "")];
    expect(selectCredentials(recordOnly, "webauthn.io", [])).toEqual([]);
  });
});

describe("base64url round trip", () => {
  it("keeps credential ids url-safe", async () => {
    const { passkey } = await createCredential(REQUEST);
    expect(passkey.credentialId).not.toMatch(/[+/=]/);
    expect(toBase64Url(fromBase64Url(passkey.credentialId))).toBe(
      passkey.credentialId,
    );
  });
});
