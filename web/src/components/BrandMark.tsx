// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The VaultCTL emblem rendered from the brand font (glyph U+E000). Because it
 * is a font glyph it inherits the current text color, so it adapts to light
 * and dark themes without swapping image assets. Size it with text classes.
 */
const LOGO_GLYPH = String.fromCharCode(0xe000);

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="VaultCTL"
      className={`font-brand leading-none ${className}`}
    >
      {LOGO_GLYPH}
    </span>
  );
}
