// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { sha256 } from "../crypto/utils.js";
import {
  buildAuthenticatorData,
  FLAG_ATTESTED_CREDENTIAL_DATA,
  FLAG_BACKED_UP,
  FLAG_BACKUP_ELIGIBLE,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
} from "./authdata.js";
import { VAULTCTL_AAGUID } from "./aaguid.js";

const ASSERTION_FLAGS =
  FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP;

describe("buildAuthenticatorData", () => {
  it("lays out an assertion as rpIdHash, flags, then a zero counter", async () => {
    const authData = await buildAuthenticatorData({
      rpId: "webauthn.io",
      flags: ASSERTION_FLAGS,
    });

    expect(authData).toHaveLength(37);
    expect(authData.subarray(0, 32)).toEqual(
      await sha256(new TextEncoder().encode("webauthn.io")),
    );
    expect(authData[32]).toBe(0x1d);
    expect([...authData.subarray(33, 37)]).toEqual([0, 0, 0, 0]);
  });

  it("appends attested credential data and sets the AT flag itself", async () => {
    const credentialId = new Uint8Array(16).fill(0x07);
    const coseKey = Uint8Array.of(0xa5, 0x01, 0x02);

    const authData = await buildAuthenticatorData({
      rpId: "example.com",
      flags: ASSERTION_FLAGS,
      attestedCredential: {
        aaguid: VAULTCTL_AAGUID,
        credentialId,
        coseKey,
      },
    });

    expect(authData[32]! & FLAG_ATTESTED_CREDENTIAL_DATA).toBe(
      FLAG_ATTESTED_CREDENTIAL_DATA,
    );
    expect(authData.subarray(37, 53)).toEqual(VAULTCTL_AAGUID);
    expect([...authData.subarray(53, 55)]).toEqual([0x00, 0x10]);
    expect(authData.subarray(55, 71)).toEqual(credentialId);
    expect(authData.subarray(71)).toEqual(coseKey);
  });

  it("encodes a credential id longer than 255 bytes big-endian", async () => {
    const credentialId = new Uint8Array(300).fill(0x01);
    const authData = await buildAuthenticatorData({
      rpId: "example.com",
      flags: ASSERTION_FLAGS,
      attestedCredential: {
        aaguid: VAULTCTL_AAGUID,
        credentialId,
        coseKey: new Uint8Array(0),
      },
    });

    expect([...authData.subarray(53, 55)]).toEqual([0x01, 0x2c]);
  });
});
