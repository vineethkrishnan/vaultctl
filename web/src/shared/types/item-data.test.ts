// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { COSE_ALG_ES256 } from "../webauthn/cose.js";
import { passkeyDataSchema } from "./item-data.js";

describe("passkeyDataSchema", () => {
  it("parses a passkey item saved before credentials were stored", () => {
    const stored = {
      rpId: "webauthn.io",
      rpName: "webauthn.io",
      credentialId: "Y3JlZA",
      userHandle: "dXNlcg",
      publicKey: "cHVi",
      discoverable: false,
      notes: "",
      customFields: [],
    };

    const parsed = passkeyDataSchema.parse(stored);

    expect(parsed.rpId).toBe("webauthn.io");
    expect(parsed.privateKey).toBe("");
    expect(parsed.userName).toBe("");
    expect(parsed.userDisplayName).toBe("");
    expect(parsed.createdAt).toBe("");
    expect(parsed.algorithm).toBe(COSE_ALG_ES256);
  });

  it("fills every field from an empty payload so a new item can be built", () => {
    expect(passkeyDataSchema.parse({})).toMatchObject({
      rpId: "",
      privateKey: "",
      algorithm: COSE_ALG_ES256,
      discoverable: false,
      customFields: [],
    });
  });
});
