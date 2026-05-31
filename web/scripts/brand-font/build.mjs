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

const WORDMARK_CODEPOINT = 0xe001; // PUA: the "VaultCTL" wordmark glyph

// Bake a potrace-traced SVG (Y-flipped group transform) into a clean glyph
// SVG in the given viewBox, so svgicons2svgfont reads it correctly.
function bakeGlyph(file, vbW, vbH) {
  const traced = readFileSync(resolve(here, file), "utf8");
  const transform = (traced.match(/<g transform="([^"]+)"/) ?? [])[1] ?? "";
  const paths = [...traced.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length === 0) throw new Error(`no paths in ${file}`);
  const baked = paths
    .map((d) => svgpath(d).transform(transform).round(1).toString())
    .join(" ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}">` +
    `<path d="${baked}"/></svg>`
  );
}

const emblemSvg = bakeGlyph("emblem-traced.svg", UPM, UPM);
const wordmarkSvg = bakeGlyph("letters/wordmark-traced.svg", 954, 144);
writeFileSync(resolve(here, "glyph-logo.svg"), emblemSvg);
writeFileSync(resolve(here, "glyph-wordmark.svg"), wordmarkSvg);

const GLYPHS = [
  { svg: emblemSvg, unicode: LOGO_CODEPOINT, name: "logo" },
  { svg: wordmarkSvg, unicode: WORDMARK_CODEPOINT, name: "wordmark" },
];

// ── Compose the SVG font, then TTF, then WOFF2 ────────────────────────────
const fontStream = new SVGIcons2SVGFontStream({
  fontName: "VaultCTL Brand",
  fontHeight: UPM,
  descent: 205, // drop glyphs so they center on the text baseline
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

for (const g of GLYPHS) {
  const glyph = Readable.from([g.svg]);
  glyph.metadata = { unicode: [String.fromCodePoint(g.unicode)], name: g.name };
  fontStream.write(glyph);
}
fontStream.end();

await done;

const ttf = svg2ttf(svgFont, { description: "VaultCTL brand glyphs" });
const woff2 = ttf2woff2(Buffer.from(ttf.buffer));
writeFileSync(resolve(outDir, "vaultctl-brand.woff2"), woff2);

console.log(
  `built vaultctl-brand.woff2 (${woff2.length} bytes): logo U+${LOGO_CODEPOINT.toString(16)}, wordmark U+${WORDMARK_CODEPOINT.toString(16)}`,
);
