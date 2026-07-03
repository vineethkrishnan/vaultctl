// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { isOneTimeCodeText } from "./otp-field";

describe("isOneTimeCodeText", () => {
  it("matches genuine 2FA / one-time-code fields", () => {
    const yes = [
      "otp",
      "app_otp",
      "one-time-code", // the standard autocomplete token
      "one time password",
      "2fa code",
      "two-factor authentication",
      "mfa",
      "totp",
      "authenticator code", // Teleport
      "verification code",
      "passcode",
      "security_code login code", // weak word + login context
      "confirmation code sms",
      "recovery code",
    ];
    for (const hay of yes) {
      expect(isOneTimeCodeText(hay), hay).toBe(true);
    }
  });

  it("does NOT match commerce / address / card / api-token 'code' fields", () => {
    const no = [
      "coupon code",
      "promo_code",
      "gift card code",
      "referral code",
      "invite code",
      "discount code",
      "zip code",
      "postal code",
      "country code", // phone country dialing code
      "area code",
      "sort code", // UK bank
      "iban",
      "cvv",
      "cvc",
      "card security code", // credit-card CSC, not 2FA
      "personal access token", // API token, not 2FA
      "api_token",
      "code", // bare, no 2FA context
      "your name",
      "email",
    ];
    for (const hay of no) {
      expect(isOneTimeCodeText(hay), hay).toBe(false);
    }
  });

  it("is case-insensitive", () => {
    expect(isOneTimeCodeText("One-Time Passcode")).toBe(true);
    expect(isOneTimeCodeText("COUPON CODE")).toBe(false);
  });
});
