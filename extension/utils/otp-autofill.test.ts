// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { shouldAutofillOtp, type OtpAutofillState } from "./otp-autofill";

// The 2FA step of a login that already submitted its password: one match, it
// carries a secret, nothing else on the page is waiting to be filled.
const secondStepPage: OtpAutofillState = {
  autofillEnabled: true,
  isUnlocked: true,
  matchCount: 1,
  matchHasTotp: true,
  hasPendingCredentialForm: false,
  hasEmptyCodeField: true,
};

function withState(overrides: Partial<OtpAutofillState>): OtpAutofillState {
  return { ...secondStepPage, ...overrides };
}

describe("shouldAutofillOtp", () => {
  it("fills the 2FA step of a page with nothing else to fill", () => {
    expect(shouldAutofillOtp(secondStepPage)).toBe(true);
  });

  it("waits while a login form still has an empty password", () => {
    // The regression this policy exists for: the code landing on its own while
    // the username and password sit empty. That fill belongs to the credential
    // pass, which writes all three together.
    expect(
      shouldAutofillOtp(withState({ hasPendingCredentialForm: true })),
    ).toBe(false);
  });

  it("fills once the credential form is no longer waiting on a password", () => {
    // Same page a moment later: the credential fill (or the user) has filled
    // the password, and the site has just revealed its code field.
    expect(
      shouldAutofillOtp(withState({ hasPendingCredentialForm: false })),
    ).toBe(true);
  });

  it("does nothing when autofill-on-load is off", () => {
    // The emblem picker is the only way in; a code must never appear unasked.
    expect(shouldAutofillOtp(withState({ autofillEnabled: false }))).toBe(false);
  });

  it("does nothing while the vault is locked", () => {
    expect(shouldAutofillOtp(withState({ isUnlocked: false }))).toBe(false);
  });

  it("does not guess between several matching logins", () => {
    // On a 2FA step there is no username on screen to disambiguate with, so a
    // host with more than one saved login waits for an explicit pick - the same
    // rule the credential autofill uses.
    expect(shouldAutofillOtp(withState({ matchCount: 2 }))).toBe(false);
  });

  it("does nothing when the page has no matching login at all", () => {
    expect(
      shouldAutofillOtp(withState({ matchCount: 0, matchHasTotp: false })),
    ).toBe(false);
  });

  it("does nothing when the single match carries no TOTP secret", () => {
    expect(shouldAutofillOtp(withState({ matchHasTotp: false }))).toBe(false);
  });

  it("never overwrites a code field the user has already typed into", () => {
    expect(shouldAutofillOtp(withState({ hasEmptyCodeField: false }))).toBe(
      false,
    );
  });
});
