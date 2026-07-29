// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure, DOM-free policy for the standalone 2FA-code autofill: the pass that
 * fills a one-time-code field on a page where there is no credential fill to
 * ride along with (the 2FA step of a login that already submitted its
 * password). Kept side-effect-free so it is unit-testable in node: the content
 * script reads the DOM and hands over the resulting facts.
 *
 * The hard part is NOT filling too eagerly. A code dropped into a page whose
 * username and password are still empty is worse than no fill at all: it looks
 * broken, it burns the user's attention on a code they can't submit yet, and on
 * a form the credential fill was about to handle it arrives out of order. So a
 * login form still waiting on its password takes precedence - the code belongs
 * to THAT fill, which writes username, password and code in one pass.
 */

export interface OtpAutofillState {
  // The "fill without a click" setting. Explicit picker clicks never consult
  // this policy; they fill the code as part of the credential fill.
  autofillEnabled: boolean;
  isUnlocked: boolean;
  // How many stored logins match this page, and whether the single match
  // carries a TOTP secret. More than one match means we cannot tell which
  // account is signing in, so the user picks instead of us guessing.
  matchCount: number;
  matchHasTotp: boolean;
  // A visible login form whose password box is still empty. Its credential
  // fill owns the code.
  hasPendingCredentialForm: boolean;
  hasEmptyCodeField: boolean;
}

export function shouldAutofillOtp(state: OtpAutofillState): boolean {
  if (!state.autofillEnabled || !state.isUnlocked) return false;
  if (state.matchCount !== 1 || !state.matchHasTotp) return false;
  if (state.hasPendingCredentialForm) return false;
  return state.hasEmptyCodeField;
}
