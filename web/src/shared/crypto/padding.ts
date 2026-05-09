// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PKCS#7-style padding to next 32-byte boundary (M5).
 *
 * Applied to item names and folder names BEFORE encryption so that
 * ciphertext lengths don't leak plaintext length info.
 *
 * Each byte of padding has the value equal to the number of padding bytes.
 * If the input is already a multiple of 32, a full block of 32 padding bytes
 * is added (standard PKCS#7 behavior).
 */

const BLOCK_SIZE = 32;

/** Pad plaintext to the next 32-byte boundary using PKCS#7. */
export function pad(data: Uint8Array): Uint8Array {
  const padLen = BLOCK_SIZE - (data.length % BLOCK_SIZE);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data, 0);
  padded.fill(padLen, data.length);
  return padded;
}

/** Remove PKCS#7 padding. Throws on invalid padding. */
export function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length === 0 || padded.length % BLOCK_SIZE !== 0) {
    throw new Error(
      `padding: invalid padded length ${padded.length} (must be non-zero multiple of ${BLOCK_SIZE})`,
    );
  }

  const padLen = padded[padded.length - 1]!;
  if (padLen < 1 || padLen > BLOCK_SIZE) {
    throw new Error(`padding: invalid pad byte 0x${padLen.toString(16)}`);
  }

  if (padLen > padded.length) {
    throw new Error("padding: pad length exceeds data length");
  }

  // Verify all padding bytes have the correct value
  for (let i = padded.length - padLen; i < padded.length; i++) {
    if (padded[i] !== padLen) {
      throw new Error("padding: inconsistent pad bytes");
    }
  }

  return padded.slice(0, padded.length - padLen);
}
