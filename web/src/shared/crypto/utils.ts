/**
 * Cast Uint8Array to BufferSource for Web Crypto API calls.
 * TS 5.7 made Uint8Array generic (Uint8Array<ArrayBufferLike>), which is
 * no longer assignable to BufferSource (ArrayBufferView<ArrayBuffer>).
 */
export function buf(data: Uint8Array): BufferSource {
  return data as unknown as BufferSource;
}

/** Best-effort scrub of a Uint8Array. Not guaranteed by JS runtimes. */
export function zero(buf: Uint8Array): void {
  buf.fill(0);
}

/** Constant-time(ish) equality comparison for Uint8Arrays. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!;
  }
  return result === 0;
}

/** Concatenate multiple Uint8Arrays into one. */
export function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/** Encode bytes to standard base64 (matching Go's base64.StdEncoding). */
export function toBase64(bytes: Uint8Array): string {
  // Use built-in btoa which produces standard base64 with padding
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Decode standard base64 to bytes (matching Go's base64.StdEncoding). */
export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
