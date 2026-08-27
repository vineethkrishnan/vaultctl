// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  assertionCredentialJSON,
  attestationCredentialJSON,
  holdsExcludedCredential,
  isSupportedRequest,
} from "./webauthn-request";

const ES256 = { alg: -7 };
const RS256 = { alg: -257 };
const EDDSA = { alg: -8 };

describe("isSupportedRequest", () => {
  it("takes a plain request", () => {
    expect(isSupportedRequest({})).toBe(true);
    expect(isSupportedRequest({ pubKeyCredParams: [ES256] })).toBe(true);
  });

  it("hands conditional mediation to the browser", () => {
    expect(isSupportedRequest({ mediation: "conditional" })).toBe(false);
    expect(isSupportedRequest({ mediation: "optional" })).toBe(true);
    expect(isSupportedRequest({ mediation: "required" })).toBe(true);
  });

  it("declines an already-aborted request", () => {
    expect(isSupportedRequest({ aborted: true })).toBe(false);
  });

  it("needs ES256 when the relying party lists algorithms", () => {
    expect(isSupportedRequest({ pubKeyCredParams: [RS256, EDDSA] })).toBe(false);
    expect(isSupportedRequest({ pubKeyCredParams: [RS256, ES256] })).toBe(true);
  });

  it("treats an absent or empty algorithm list as the spec defaults", () => {
    expect(isSupportedRequest({ pubKeyCredParams: [] })).toBe(true);
    expect(isSupportedRequest({ pubKeyCredParams: undefined })).toBe(true);
  });

  it("leaves a request for a roaming security key to the browser", () => {
    expect(isSupportedRequest({ authenticatorAttachment: "cross-platform" })).toBe(
      false,
    );
    expect(isSupportedRequest({ authenticatorAttachment: "platform" })).toBe(true);
    expect(isSupportedRequest({ authenticatorAttachment: undefined })).toBe(true);
  });
});

describe("attestationCredentialJSON", () => {
  const json = attestationCredentialJSON({
    credentialId: "Y3JlZC1pZA",
    clientDataJSON: "Y2xpZW50",
    attestationObject: "YXR0ZXN0",
    authenticatorData: "YXV0aA",
    publicKey: "cHVi",
    publicKeyAlgorithm: -7,
    extensions: { credProps: { rk: true } },
  });

  it("uses the field names a relying party reads", () => {
    expect(json).toEqual({
      id: "Y3JlZC1pZA",
      rawId: "Y3JlZC1pZA",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        clientDataJSON: "Y2xpZW50",
        attestationObject: "YXR0ZXN0",
        authenticatorData: "YXV0aA",
        publicKey: "cHVi",
        publicKeyAlgorithm: -7,
        transports: ["internal", "hybrid"],
      },
    });
  });

  it("hands out a fresh transports array each call", () => {
    const first = attestationCredentialJSON({
      credentialId: "a",
      clientDataJSON: "b",
      attestationObject: "c",
      authenticatorData: "d",
      publicKey: "e",
      publicKeyAlgorithm: -7,
      extensions: {},
    });
    (first.response as { transports: string[] }).transports.push("nfc");
    const second = attestationCredentialJSON({
      credentialId: "a",
      clientDataJSON: "b",
      attestationObject: "c",
      authenticatorData: "d",
      publicKey: "e",
      publicKeyAlgorithm: -7,
      extensions: {},
    });
    expect((second.response as { transports: string[] }).transports).toEqual([
      "internal",
      "hybrid",
    ]);
  });
});

describe("assertionCredentialJSON", () => {
  it("uses the field names a relying party reads", () => {
    expect(
      assertionCredentialJSON({
        credentialId: "Y3JlZC1pZA",
        clientDataJSON: "Y2xpZW50",
        authenticatorData: "YXV0aA",
        signature: "c2ln",
        userHandle: "dXNlcg",
        extensions: {},
      }),
    ).toEqual({
      id: "Y3JlZC1pZA",
      rawId: "Y3JlZC1pZA",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: "Y2xpZW50",
        authenticatorData: "YXV0aA",
        signature: "c2ln",
        userHandle: "dXNlcg",
      },
    });
  });

  it("reports a missing user handle as null, not an empty string", () => {
    const json = assertionCredentialJSON({
      credentialId: "a",
      clientDataJSON: "b",
      authenticatorData: "c",
      signature: "d",
      userHandle: "",
      extensions: {},
    });
    expect((json.response as { userHandle: unknown }).userHandle).toBeNull();
  });
});

describe("holdsExcludedCredential", () => {
  it("treats an empty exclusion list as no restriction", () => {
    expect(holdsExcludedCredential(["aaa"], [])).toBe(false);
    expect(holdsExcludedCredential([], [])).toBe(false);
  });

  it("reports a match so a duplicate passkey is never created", () => {
    expect(holdsExcludedCredential(["aaa", "bbb"], ["bbb"])).toBe(true);
  });

  it("lets the ceremony proceed when nothing held is excluded", () => {
    expect(holdsExcludedCredential(["aaa"], ["zzz"])).toBe(false);
    expect(holdsExcludedCredential([], ["zzz"])).toBe(false);
  });
});
