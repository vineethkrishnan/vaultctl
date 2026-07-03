// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure, DOM-free detection of one-time-code / 2FA fields from a field's text
 * signals (name, id, autocomplete, aria-label, placeholder joined into one
 * haystack). Kept side-effect-free so it is unit-testable in node: the content
 * script builds the haystack from the real element.
 *
 * The hard part is NOT over-matching. A bare "code"/"token"/"pin" appears on
 * coupon, promo, gift-card, postal, area/country-dialing, bank and API-token
 * fields that have nothing to do with 2FA, so decorating them with the code
 * picker offers a code the extension can't meaningfully fill. Strong 2FA
 * signals match outright; the weak words only match with a 2FA-ish companion,
 * and the known commerce/address/card false positives are excluded first.
 */

// Commerce / address / card / bank "code" fields that are never a 2FA code.
// Checked first so they can never be pulled in by the weak-word rule below.
const NOT_ONE_TIME_CODE =
  /coupon|promo|voucher|gift|referral|invite|discount|redeem|\bzip\b|postal|\bstate\b|province|country|\barea\b|dial|sort code|swift|iban|routing|\bcvv\b|\bcvc\b|\bcvc2\b|\bcsc\b|\bcard\b|expir/;

// Unambiguous 2FA / one-time-code signals. `one time` also covers the standard
// `autocomplete="one-time-code"` most real 2FA fields carry.
const STRONG_ONE_TIME_CODE =
  /\botp\b|one time|2fa|two factor|\bmfa\b|totp|passcode|authenticat|verification code/;

// Weak words that are only a 2FA code when a companion word says so.
const WEAK_CODE_WORD = /\bcode\b|\btoken\b|\bpin\b/;
const CODE_CONTEXT =
  /2fa|mfa|\botp\b|auth|verif|two factor|one time|passcode|login|sign in|\bsms\b|mail|confirm|recovery|backup/;

export function isOneTimeCodeText(haystack: string): boolean {
  // Normalise separators (name="app_otp", autocomplete="one-time-code", etc.)
  // to spaces so the word-boundary patterns below aren't defeated by "_" and
  // "-" being word characters.
  const hay = haystack.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (NOT_ONE_TIME_CODE.test(hay)) return false;
  if (STRONG_ONE_TIME_CODE.test(hay)) return true;
  return WEAK_CODE_WORD.test(hay) && CODE_CONTEXT.test(hay);
}
