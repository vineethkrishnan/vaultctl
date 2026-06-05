// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Minimal ZIP reader.
 *
 * Supports the subset required to read 1Password's .1pux bundles:
 *   - ZIP64 NOT supported (1PUX exports have never needed it)
 *   - Supports "store" (method 0) and "deflate" (method 8) compression
 *   - Ignores encryption, multi-disk, data descriptors
 *
 * We avoid a third-party dep because DecompressionStream is part of the
 * WHATWG Streams standard, available in every target browser and in the
 * Node 22 runtime used by vitest.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Locate end-of-central-directory record (EOCD). Scan backwards from the
  // end of the buffer - EOCD may be followed by a comment of up to 64KB.
  let eocdOffset = -1;
  const scanLimit = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= scanLimit; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("zip: end-of-central-directory record not found");
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirSize = view.getUint32(eocdOffset + 12, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const entries: ZipEntry[] = [];
  let cursor = centralDirOffset;
  const centralDirEnd = centralDirOffset + centralDirSize;

  for (let index = 0; index < totalEntries && cursor < centralDirEnd; index++) {
    if (view.getUint32(cursor, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`zip: invalid central directory entry at ${cursor}`);
    }

    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLength);
    const name = new TextDecoder().decode(nameBytes);

    cursor += 46 + nameLength + extraLength + commentLength;

    // Skip directory entries.
    if (name.endsWith("/")) continue;

    // Read the local file header to figure out where the payload starts.
    if (view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_SIGNATURE) {
      throw new Error(`zip: invalid local file header for ${name}`);
    }
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;

    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data: Uint8Array;

    if (compressionMethod === 0) {
      data = compressed;
    } else if (compressionMethod === 8) {
      data = await inflateRaw(compressed);
    } else {
      throw new Error(`zip: unsupported compression method ${compressionMethod} for ${name}`);
    }

    if (uncompressedSize > 0 && data.length !== uncompressedSize) {
      throw new Error(
        `zip: decompressed size mismatch for ${name} (expected ${uncompressedSize}, got ${data.length})`,
      );
    }

    entries.push({ name, data });
  }

  return entries;
}

/**
 * Decompress a raw DEFLATE payload via DecompressionStream.
 *
 * We route the bytes through a Response body so the plumbing sidesteps the
 * stricter Uint8Array<ArrayBuffer> vs BufferSource generics TypeScript 5
 * enforces on ReadableStream.pipeThrough.
 */
async function inflateRaw(input: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer-backed Uint8Array so the Response + stream
  // generics (stricter since TypeScript 5.7) accept it as BodyInit.
  const buffer = new ArrayBuffer(input.byteLength);
  new Uint8Array(buffer).set(input);
  const source = new Response(buffer).body;
  if (!source) {
    throw new Error("zip: ReadableStream unavailable for decompression");
  }
  const decompressed = source.pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = await new Response(decompressed).arrayBuffer();
  return new Uint8Array(inflated);
}

/** Find the first entry whose name matches. Returns the raw payload or null. */
export function findEntry(entries: readonly ZipEntry[], name: string): Uint8Array | null {
  for (const entry of entries) {
    if (entry.name === name) return entry.data;
  }
  return null;
}
