// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Minimal, dependency-free QR Code encoder (ISO/IEC 18004).
 *
 * Built in-house on purpose: this is a credential manager, so we do not pull a
 * third-party QR library into the client bundle. Scope is intentionally small —
 * byte mode only, versions 1..10, all four EC levels — which is more than enough
 * for a recovery key (~54 bytes) or an otpauth:// URL (~120 bytes).
 *
 * encodeQR(text) returns a square matrix of booleans (true = dark module),
 * without a quiet zone; callers add the margin when rendering.
 */

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

// [ecCodewordsPerBlock, group1Blocks, group1Data, group2Blocks, group2Data]
type EcBlockSpec = [number, number, number, number, number];

// EC characteristics per ISO/IEC 18004 Table 9, versions 1..10.
const EC_BLOCKS: Record<number, Record<ErrorCorrectionLevel, EcBlockSpec>> = {
  1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
  2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
  3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
  4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
  5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
  7: { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8: { L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9: { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] },
};

function ecSpec(version: number, ec: ErrorCorrectionLevel): EcBlockSpec {
  return EC_BLOCKS[version]![ec];
}

// Alignment pattern centre coordinates per version (ISO/IEC 18004 Annex E).
const ALIGN_POS: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// Pre-computed 15-bit format information strings (BCH-encoded and masked),
// indexed by EC level then mask 0..7. ISO/IEC 18004 Table C.1.
const FORMAT_INFO: Record<ErrorCorrectionLevel, number[]> = {
  L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
  M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
  Q: [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
  H: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b],
};

// Pre-computed 18-bit version information (BCH), versions 7..10. Table D.1.
const VERSION_INFO: Record<number, number> = {
  7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3,
};

// ---------------------------------------------------------------------------
// GF(256) arithmetic for Reed-Solomon (primitive polynomial 0x11d).
// ---------------------------------------------------------------------------
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, GF_EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEC(data: number[], ecCount: number): number[] {
  const gen = rsGeneratorPoly(ecCount);
  const ec = new Array<number>(ecCount).fill(0);
  for (const d of data) {
    const factor = d ^ ec[0]!;
    ec.shift();
    ec.push(0);
    for (let i = 0; i < ecCount; i++) ec[i] = ec[i]! ^ gfMul(gen[i + 1]!, factor);
  }
  return ec;
}

// ---------------------------------------------------------------------------
// Data encoding
// ---------------------------------------------------------------------------
function dataCodewordCount(version: number, ec: ErrorCorrectionLevel): number {
  const [, g1, g1d, g2, g2d] = ecSpec(version, ec);
  return g1 * g1d + g2 * g2d;
}

function chooseVersion(byteLen: number, ec: ErrorCorrectionLevel): number {
  for (let v = 1; v <= 10; v++) {
    const countBits = v <= 9 ? 8 : 16;
    const needBits = 4 + countBits + 8 * byteLen;
    if (needBits <= dataCodewordCount(v, ec) * 8) return v;
  }
  throw new Error("qr: data too long for supported versions (1-10)");
}

function buildDataCodewords(bytes: Uint8Array, version: number, ec: ErrorCorrectionLevel): number[] {
  const capacityBits = dataCodewordCount(version, ec) * 8;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode indicator
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const pad = [0xec, 0x11];
  for (let i = 0; bits.length < capacityBits; i++) push(pad[i % 2]!, 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]!;
    codewords.push(v);
  }
  return codewords;
}

function interleave(dataCW: number[], version: number, ec: ErrorCorrectionLevel): number[] {
  const [ecPerBlock, g1, g1d, g2, g2d] = ecSpec(version, ec);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let idx = 0;
  for (let i = 0; i < g1; i++) {
    const data = dataCW.slice(idx, idx + g1d);
    idx += g1d;
    blocks.push({ data, ec: rsComputeEC(data, ecPerBlock) });
  }
  for (let i = 0; i < g2; i++) {
    const data = dataCW.slice(idx, idx + g2d);
    idx += g2d;
    blocks.push({ data, ec: rsComputeEC(data, ecPerBlock) });
  }

  const result: number[] = [];
  const maxData = Math.max(g1d, g2d);
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) result.push(b.data[i]!);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const b of blocks) result.push(b.ec[i]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------
type Grid = boolean[][];

function newGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

function getBit(value: number, i: number): boolean {
  return ((value >> i) & 1) !== 0;
}

function placeFunctionPatterns(modules: Grid, isFunc: Grid, version: number): void {
  const size = modules.length;

  const drawFinder = (row: number, col: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inner = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        modules[r]![c] = inner !== 2 && inner <= 3; // 7x7 ring + 3x3 centre
        isFunc[r]![c] = true;
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0;
    if (!isFunc[6]![i]) { modules[6]![i] = v; isFunc[6]![i] = true; }
    if (!isFunc[i]![6]) { modules[i]![6] = v; isFunc[i]![6] = true; }
  }

  // Alignment patterns at every centre-coordinate pair EXCEPT the three that
  // overlap the finder patterns: (first,first), (first,last), (last,first).
  // Patterns that land on the timing row/column ARE drawn (they take precedence
  // over timing), so we must not skip merely-isFunc cells here.
  const centers = ALIGN_POS[version]!;
  const n = centers.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      const r = centers[i]!;
      const c = centers[j]!;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          modules[r + dr]![c + dc] = ring !== 1;
          isFunc[r + dr]![c + dc] = true;
        }
      }
    }
  }

  // Reserve format + version areas (marked function, filled later). The dark
  // module is part of the format reservation.
  for (const [x, y] of formatCells(size)) isFunc[y]![x] = true;
  if (version >= 7) reserveVersion(isFunc, size);
}

// (x, y) coordinates of the 15 format-info modules per copy, plus the dark
// module. ISO/IEC 18004 §8.9 — note these are (col, row), placed as [y][x].
function formatCells(size: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let i = 0; i <= 5; i++) cells.push([8, i]);
  cells.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) cells.push([14 - i, 8]);
  for (let i = 0; i < 8; i++) cells.push([size - 1 - i, 8]);
  for (let i = 8; i < 15; i++) cells.push([8, size - 15 + i]);
  cells.push([8, size - 8]); // dark module at (row size-8, col 8)
  return cells;
}

function reserveVersion(isFunc: Grid, size: number): void {
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    isFunc[a]![b] = true;
    isFunc[b]![a] = true;
  }
}

function placeData(modules: Grid, isFunc: Grid, bits: number[]): void {
  const size = modules.length;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (!isFunc[row]![col] && i < bits.length) {
          modules[row]![col] = bits[i] === 1;
          i++;
        }
      }
    }
  }
}

function maskCondition(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return false;
  }
}

function applyMask(modules: Grid, isFunc: Grid, mask: number): void {
  const size = modules.length;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunc[r]![c] && maskCondition(mask, r, c)) modules[r]![c] = !modules[r]![c];
    }
  }
}

function drawFormat(modules: Grid, ec: ErrorCorrectionLevel, mask: number): void {
  const size = modules.length;
  const fmt = FORMAT_INFO[ec][mask]!;
  const set = (x: number, y: number, bit: boolean) => { modules[y]![x] = bit; };
  for (let i = 0; i <= 5; i++) set(8, i, getBit(fmt, i));
  set(8, 7, getBit(fmt, 6));
  set(8, 8, getBit(fmt, 7));
  set(7, 8, getBit(fmt, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(fmt, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(fmt, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(fmt, i));
  set(8, size - 8, true); // dark module at (row size-8, col 8)
}

function drawVersion(modules: Grid, version: number): void {
  if (version < 7) return;
  const size = modules.length;
  const bits = VERSION_INFO[version]!;
  for (let i = 0; i < 18; i++) {
    const bit = getBit(bits, i);
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    modules[a]![b] = bit;
    modules[b]![a] = bit;
  }
}

function penalty(modules: Grid): number {
  const size = modules.length;
  let score = 0;

  // Rule 1: runs of 5+ same-colour modules in each row and column.
  const lineRuns = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i++) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (get(i, j) === get(i, j - 1)) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  };
  lineRuns((i, j) => modules[i]![j]!);
  lineRuns((i, j) => modules[j]![i]!);

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r]![c];
      if (v === modules[r]![c + 1] && v === modules[r + 1]![c] && v === modules[r + 1]![c + 1]) score += 3;
    }
  }

  // Rule 3: 1:1:3:1:1 finder-like pattern with 4 light modules on a side.
  const pattern = [true, false, true, true, true, false, true];
  const matchAt = (get: (k: number) => boolean, len: number, start: number): boolean => {
    for (let k = 0; k < 7; k++) if (get(start + k) !== pattern[k]) return false;
    const before = [start - 4, start - 3, start - 2, start - 1].every((k) => k >= 0 && !get(k));
    const after = [start + 7, start + 8, start + 9, start + 10].every((k) => k < len && !get(k));
    return before || after;
  };
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= size - 7; j++) {
      if (matchAt((k) => modules[i]![k]!, size, j)) score += 40;
      if (matchAt((k) => modules[k]![i]!, size, j)) score += 40;
    }
  }

  // Rule 4: balance of dark vs light modules.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r]![c]) dark++;
  const total = size * size;
  const ratio = (dark * 100) / total;
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

/**
 * Encode `text` as a QR matrix. Returns boolean[][] (true = dark), no quiet zone.
 * Throws if the data does not fit in versions 1..10 at the given EC level.
 */
export function encodeQR(text: string, ec: ErrorCorrectionLevel = "M", forceMask?: number): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length, ec);
  const size = 17 + 4 * version;

  const dataCW = buildDataCodewords(bytes, version, ec);
  const allCW = interleave(dataCW, version, ec);
  const bits: number[] = [];
  for (const cw of allCW) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);

  const baseModules = newGrid(size);
  const isFunc = newGrid(size);
  placeFunctionPatterns(baseModules, isFunc, version);
  placeData(baseModules, isFunc, bits);

  const build = (mask: number): boolean[][] => {
    const candidate = cloneGrid(baseModules);
    applyMask(candidate, isFunc, mask);
    drawFormat(candidate, ec, mask);
    drawVersion(candidate, version);
    return candidate;
  };

  if (forceMask !== undefined) return build(forceMask);

  let bestScore = Infinity;
  let bestModules = build(0);
  for (let mask = 0; mask < 8; mask++) {
    const candidate = build(mask);
    const s = penalty(candidate);
    if (s < bestScore) {
      bestScore = s;
      bestModules = candidate;
    }
  }
  return bestModules;
}
