// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Clipboard helpers with a safe, non-destructive auto-clear.
 *
 * The naive "write '' 30s later" approach destroys whatever the user copied in
 * the meantime. Instead, before clearing we read the clipboard back and only
 * wipe it if it STILL holds the secret we wrote, and only while the popup is
 * focused (clipboard reads require focus and the popup is usually gone by then).
 */

const AUTO_CLEAR_MS = 30_000;

export async function copySecret(secret: string): Promise<boolean> {
  if (!secret) return false;
  try {
    await navigator.clipboard.writeText(secret);
  } catch {
    return false;
  }
  scheduleClipboardClear(secret);
  return true;
}

function scheduleClipboardClear(secret: string): void {
  setTimeout(() => {
    void (async () => {
      if (!document.hasFocus()) return;
      try {
        const current = await navigator.clipboard.readText();
        if (current === secret) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        // Clipboard read may be denied (no focus / permission); leave it be
        // rather than blindly wiping something the user copied since.
      }
    })();
  }, AUTO_CLEAR_MS);
}
