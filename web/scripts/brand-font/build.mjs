// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Builds the VaultCTL brand font: a small WOFF2 carrying the shield emblem as
// a glyph so the logo can be rendered as a font character anywhere in the app.
//
// Source of truth: emblem-traced.svg (potrace vectorization of the emblem).
// Regenerate that with:
//   magick web/public/light/app-icons/1024x1024.png -background white -flatten \
//     -alpha off -threshold 55% web/scripts/brand-font/emblem.pbm
//   potrace web/scripts/brand-font/emblem.pbm -s --turdsize 8 --alphamax 1 \
//     -o web/scripts/brand-font/emblem-traced.svg
//
// Then: node web/scripts/brand-font/build.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import svgpath from "svgpath";
import { SVGIcons2SVGFontStream } from "svgicons2svgfont";
import svg2ttf from "svg2ttf";
import ttf2woff2 from "ttf2woff2";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../../public/fonts");
mkdirSync(outDir, { recursive: true });

const UPM = 1024; // units per em
const LOGO_CODEPOINT = 0xe000; // PUA: the emblem glyph

// ── Extract + bake the traced emblem path ─────────────────────────────────
const traced = readFileSync(resolve(here, "emblem-traced.svg"), "utf8");
const transform = (traced.match(/<g transform="([^"]+)"/) ?? [])[1] ?? "";
const paths = [...traced.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
if (paths.length === 0) throw new Error("no paths in emblem-traced.svg");

// potrace emits a Y-flipped coordinate system; bake the group transform into
// each subpath, then concatenate so holes (keyhole, V) cut out via nonzero.
const baked = paths
  .map((d) => svgpath(d).transform(transform).round(1).toString())
  .join(" ");

const glyphSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UPM} ${UPM}">` +
  `<path d="${baked}"/></svg>`;

writeFileSync(resolve(here, "glyph-logo.svg"), glyphSvg);

// ── Compose the SVG font, then TTF, then WOFF2 ────────────────────────────
const fontStream = new SVGIcons2SVGFontStream({
  fontName: "VaultCTL Brand",
  fontHeight: UPM,
  descent: 205, // drop the icon so it centers on the text baseline
  normalize: true,
  centerHorizontally: true,
  log: () => {},
});

let svgFont = "";
fontStream.on("data", (chunk) => (svgFont += chunk));

const done = new Promise((res, rej) => {
  fontStream.on("end", res);
  fontStream.on("error", rej);
});

const glyph = Readable.from([glyphSvg]);
glyph.metadata = { unicode: [String.fromCodePoint(LOGO_CODEPOINT)], name: "logo" };
fontStream.write(glyph);
fontStream.end();

await done;

const ttf = svg2ttf(svgFont, { description: "VaultCTL brand glyphs" });
const woff2 = ttf2woff2(Buffer.from(ttf.buffer));
writeFileSync(resolve(outDir, "vaultctl-brand.woff2"), woff2);

console.log(
  `built vaultctl-brand.woff2 (${woff2.length} bytes), logo at U+${LOGO_CODEPOINT.toString(16).toUpperCase()}`,
);
