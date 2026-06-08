// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Password-health checks shared by the popup checkup and the background's
 * compromised-credential flag. Weak/reused are pure local computations; the
 * breach check uses the Have I Been Pwned range API with k-anonymity (only the
 * first 5 chars of the SHA-1 hash ever leave the device).
 */

// A heuristic "weak" judgement - not a full strength meter. Flags short
// passwords and medium-length ones that lack character-class variety, which is
// enough to surface the obviously-poor ones without bundling zxcvbn.
export function isWeakPassword(password: string): boolean {
  if (!password) return false;
  if (password.length < 8) return true;
  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/[0-9]/.test(password)) classes++;
  if (/[^a-zA-Z0-9]/.test(password)) classes++;
  return password.length < 12 && classes < 3;
}

// The set of passwords that appear on two or more items (reused).
export function reusedPasswords(passwords: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const password of passwords) {
    if (password) counts.set(password, (counts.get(password) ?? 0) + 1);
  }
  const reused = new Set<string>();
  for (const [password, count] of counts) {
    if (count >= 2) reused.add(password);
  }
  return reused;
}

async function sha1HexUpper(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// Returns how many breaches the password appears in per HIBP (0 = not found).
// k-anonymous: only the 5-char SHA-1 prefix is sent; the full hash never leaves
// the device. "Add-Padding" blunts response-size fingerprinting. Returns 0 on
// any network/parse error so a failed check never reads as "compromised".
export async function breachCount(password: string): Promise<number> {
  if (!password) return 0;
  let hash: string;
  try {
    hash = await sha1HexUpper(password);
  } catch {
    return 0;
  }
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return 0;
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [lineSuffix, count] = line.trim().split(":");
      if (lineSuffix === suffix) return Number(count) || 0;
    }
  } catch {
    return 0;
  }
  return 0;
}
