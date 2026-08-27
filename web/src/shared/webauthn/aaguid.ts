// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The vaultctl authenticator's AAGUID, as it appears in attested credential
 * data.
 *
 * This identifies the authenticator model, not the user or the install, so it
 * is a single fixed value shared by every vaultctl client. It must never
 * change: relying parties that keep an authenticator allowlist key off it, and
 * a new value would read as a different authenticator for credentials already
 * registered.
 */

export const VAULTCTL_AAGUID = Uint8Array.of(
  0x47, 0xe1, 0x77, 0x8f, 0x0d, 0x8d, 0x44, 0x90,
  0xa3, 0xb2, 0x6b, 0x2c, 0xba, 0xef, 0x07, 0xcc,
);
