/**
 * Background service worker for the vaultctl browser extension.
 *
 * Responsibilities:
 * - Manages auth state (tokens)
 * - Performs crypto operations (reuses M6 crypto module)
 * - Communicates with the vaultctl API
 * - Responds to popup and content script messages
 * - Auto-lock on inactivity
 */

export default defineBackground(() => {
  let accessToken: string | null = null;
  let autoLockTimer: ReturnType<typeof setTimeout> | undefined;
  const AUTO_LOCK_MS = 15 * 60 * 1000;

  function resetAutoLock() {
    if (autoLockTimer) clearTimeout(autoLockTimer);
    autoLockTimer = setTimeout(() => {
      accessToken = null;
      // Notify popup
      browser.runtime.sendMessage({ type: "locked" }).catch(() => {});
    }, AUTO_LOCK_MS);
  }

  // Handle messages from popup and content scripts
  browser.runtime.onMessage.addListener(
    (message: { type: string; [key: string]: unknown }, _sender, sendResponse) => {
      resetAutoLock();

      switch (message.type) {
        case "getAuthState":
          sendResponse({ isAuthenticated: !!accessToken });
          break;

        case "setToken":
          accessToken = message.token as string;
          sendResponse({ ok: true });
          break;

        case "lock":
          accessToken = null;
          sendResponse({ ok: true });
          break;

        case "getServerUrl":
          sendResponse({
            url: localStorage.getItem("vaultctl_server_url") ?? "",
          });
          break;

        default:
          sendResponse({ error: "unknown message type" });
      }

      return true; // keep message channel open for async
    },
  );

  console.log("[vaultctl] Background service worker started");
});
