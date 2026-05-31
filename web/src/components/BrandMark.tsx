// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * VaultCTL brand glyphs rendered from the brand font:
 *   - "emblem"   (U+E000): the shield + keyhole + V mark
 *   - "wordmark" (U+E001): the "VaultCTL" logotype, matching the logo
 * Being font glyphs they inherit the current text color, so they adapt to
 * light/dark with no image swap. Size them with text classes.
 */
const GLYPHS = { emblem: 0xe000, wordmark: 0xe001 } as const;

export function BrandMark({
  variant = "emblem",
  className = "",
}: {
  variant?: keyof typeof GLYPHS;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label="VaultCTL"
      className={`font-brand leading-none ${className}`}
    >
      {String.fromCharCode(GLYPHS[variant])}
    </span>
  );
}
