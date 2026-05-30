// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Background service worker for the vaultctl browser extension.
 *
 * Responsibilities:
 * - Manages auth state (tokens) and in-memory key material
 * - Performs crypto operations using the shared M6 crypto module
 * - Holds captured logins from content-script submit listeners
 * - Auto-locks on inactivity, zeroing all key material
 * - Responds to popup and content script messages
 *
 * This service worker is the M11 equivalent of the M7 web worker: all
 * decrypted key bytes live in module scope and never leave here.
 */

import {
  aesGcmEncrypt,
  aesGcmDecrypt,
  aesKeyUnwrap,
  importRSAPrivateKey,
  importEd25519PrivateKey,
  rsaOaepDecrypt,
  parseBlob,
  serializeBlob,
  fromBase64,
  toBase64,
  zero,
  AlgID,
} from "@shared/crypto";

// ===========================================================================
// Types
// ===========================================================================

interface VaultKeyMaterial {
  vaultId: string;
  encryptedVaultKey: string;
  vaultType?: "personal" | "shared";
  vaultName?: string;
}

interface CapturedLogin {
  id: string;
  url: string;
  username: string;
  password: string;
  capturedAt: number;
}

interface IncomingMessage {
  type: string;
  [key: string]: unknown;
}

type SendResponse = (response: unknown) => void;

// ===========================================================================
// Module-scope state
// ===========================================================================

const AUTO_LOCK_MS = 15 * 60 * 1000;
const CAPTURE_TTL_MS = 10 * 60 * 1000;
const CAPTURE_MAX = 10;

let accessToken: string | null = null;
let stretchedKey: Uint8Array | null = null;
let rsaPrivateKey: CryptoKey | null = null;
const identityKey: { value: CryptoKey | null } = { value: null };
const vaultKeys = new Map<string, Uint8Array>();
const vaultMeta = new Map<string, { name: string; type: string }>();

const capturedLogins: CapturedLogin[] = [];

let autoLockTimer: ReturnType<typeof setTimeout> | undefined;

// ===========================================================================
// Helpers
// ===========================================================================

function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[vaultctl:bg]", ...args);
  }
}

function resetAutoLock(): void {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(() => doLock(), AUTO_LOCK_MS);
}

function doLock(): void {
  accessToken = null;
  if (stretchedKey) {
    zero(stretchedKey);
    stretchedKey = null;
  }
  rsaPrivateKey = null;
  identityKey.value = null;
  for (const [, vaultKey] of vaultKeys) {
    zero(vaultKey);
  }
  vaultKeys.clear();
  vaultMeta.clear();
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = undefined;
  }
  browser.runtime.sendMessage({ type: "locked" }).catch(() => {});
}

function pruneStaleCaptures(): void {
  const cutoff = Date.now() - CAPTURE_TTL_MS;
  while (capturedLogins.length && capturedLogins[0]!.capturedAt < cutoff) {
    capturedLogins.shift();
  }
}

function makeCaptureId(): string {
  return `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function showCaptureNotification(url: string, username: string): Promise<void> {
  const hostname = safeHostname(url);
  try {
    await browser.notifications.create(`vaultctl-capture-${Date.now()}`, {
      type: "basic",
      // Fall back to the extension's default icon; the MV3 manifest may not
      // expose a fixed path here, so we let the browser pick.
      iconUrl: browser.runtime.getURL("icon/128.png" as never),
      title: "Save to vaultctl?",
      message: `Capture login for ${username || "(no username)"} on ${hostname}`,
    });
  } catch {
    // Notifications may fail if the icon path is absent or permission
    // was denied; fall back to the action badge.
  }
  try {
    await browser.action.setBadgeText({ text: String(capturedLogins.length) });
    await browser.action.setBadgeBackgroundColor({ color: "#2563eb" });
  } catch {
    // swallow — badge API optional across browsers
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function getVaultKey(vaultId: string): Uint8Array {
  const vaultKey = vaultKeys.get(vaultId);
  if (!vaultKey) {
    throw new Error(`No key loaded for vault ${vaultId}`);
  }
  return vaultKey;
}

// ===========================================================================
// Init: decrypt RSA + identity + vault keys (shape matches M7 worker `init`)
// ===========================================================================

async function handleInit(payload: {
  stretchedKey: ArrayBuffer | Uint8Array | number[];
  encryptedPrivateKey: string;
  encryptedIdentityPrivateKey: string;
  vaults: VaultKeyMaterial[];
}): Promise<void> {
  const rawStretchedKey =
    payload.stretchedKey instanceof Uint8Array
      ? new Uint8Array(payload.stretchedKey)
      : new Uint8Array(payload.stretchedKey as ArrayBuffer);
  stretchedKey = rawStretchedKey;

  // Decrypt RSA private key
  const encryptedRsaPrivateBlob = parseBlob(fromBase64(payload.encryptedPrivateKey));
  const rsaPrivateBytes = await aesGcmDecrypt(rawStretchedKey, encryptedRsaPrivateBlob);
  rsaPrivateKey = await importRSAPrivateKey(rsaPrivateBytes);
  zero(rsaPrivateBytes);

  // Decrypt Ed25519 identity private key
  const encryptedIdentityBlob = parseBlob(fromBase64(payload.encryptedIdentityPrivateKey));
  const ed25519PrivateBytes = await aesGcmDecrypt(rawStretchedKey, encryptedIdentityBlob);
  identityKey.value = await importEd25519PrivateKey(ed25519PrivateBytes);
  zero(ed25519PrivateBytes);

  // Decrypt each vault key using either AES-KW (personal) or RSA-OAEP (shared)
  for (const vault of payload.vaults) {
    const wrappedBlob = parseBlob(fromBase64(vault.encryptedVaultKey));
    let vaultKeyBytes: Uint8Array;

    if (wrappedBlob.alg === AlgID.AES_256_KW) {
      vaultKeyBytes = await aesKeyUnwrap(rawStretchedKey, wrappedBlob);
    } else if (wrappedBlob.alg === AlgID.RSA_OAEP_SHA256) {
      if (!rsaPrivateKey) {
        throw new Error("RSA private key not loaded before unwrapping shared vault key");
      }
      vaultKeyBytes = await rsaOaepDecrypt(rsaPrivateKey, wrappedBlob);
    } else {
      throw new Error(`Unsupported vault key algorithm: 0x${wrappedBlob.alg.toString(16)}`);
    }

    vaultKeys.set(vault.vaultId, vaultKeyBytes);
    vaultMeta.set(vault.vaultId, {
      name: vault.vaultName ?? "Vault",
      type: vault.vaultType ?? "personal",
    });
  }

  devLog("initialised", vaultKeys.size, "vault keys");
}

// ===========================================================================
// Message handler
// ===========================================================================

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (
      rawMessage: unknown,
      _sender: Browser.runtime.MessageSender,
      sendResponse: SendResponse,
    ): boolean => {
      const message = rawMessage as IncomingMessage;
      if (!message || typeof message.type !== "string") {
        sendResponse({ error: "invalid message" });
        return false;
      }

      if (message.type !== "getCapturedLogins" && message.type !== "getAuthState") {
        resetAutoLock();
      }

      void (async () => {
        try {
          switch (message.type) {
            // -----------------------------------------------------------
            // Auth / lifecycle
            // -----------------------------------------------------------
            case "getAuthState": {
              sendResponse({
                isAuthenticated: !!accessToken,
                isUnlocked: stretchedKey !== null,
                vaultCount: vaultKeys.size,
              });
              return;
            }

            case "getSession": {
              // Lets the popup resume after it was closed while the worker
              // stayed unlocked. The token never leaves the extension.
              sendResponse({
                isUnlocked: stretchedKey !== null,
                accessToken,
                vaults: [...vaultMeta.entries()].map(([id, meta]) => ({
                  id,
                  name: meta.name,
                  type: meta.type,
                })),
              });
              return;
            }

            case "setToken": {
              accessToken = (message.token as string) ?? null;
              sendResponse({ ok: true });
              return;
            }

            case "unlock": {
              await handleInit(
                message as unknown as Parameters<typeof handleInit>[0],
              );
              resetAutoLock();
              sendResponse({ ok: true, vaultCount: vaultKeys.size });
              return;
            }

            case "lock": {
              doLock();
              sendResponse({ ok: true });
              return;
            }

            case "getServerUrl": {
              // localStorage is not available in MV3 service workers; use storage.local.
              const stored = await browser.storage.local.get("vaultctl_server_url");
              sendResponse({ url: (stored.vaultctl_server_url as string) ?? "" });
              return;
            }

            case "setServerUrl": {
              await browser.storage.local.set({
                vaultctl_server_url: message.url as string,
              });
              sendResponse({ ok: true });
              return;
            }

            // -----------------------------------------------------------
            // Crypto ops — exposed for the popup
            // -----------------------------------------------------------
            case "encryptForVault": {
              const vaultId = message.vaultId as string;
              const plaintextBytes =
                message.plaintext instanceof Uint8Array
                  ? (message.plaintext as Uint8Array)
                  : new Uint8Array(message.plaintext as ArrayBuffer);
              const vaultKey = getVaultKey(vaultId);
              const encryptedBlob = await aesGcmEncrypt(vaultKey, plaintextBytes);
              const wireBytes = serializeBlob(encryptedBlob);
              sendResponse({ ok: true, blob: toBase64(wireBytes) });
              return;
            }

            case "decryptForVault": {
              const vaultId = message.vaultId as string;
              const blobBase64 = message.blobB64 as string;
              const vaultKey = getVaultKey(vaultId);
              const parsedBlob = parseBlob(fromBase64(blobBase64));
              const plaintextBytes = await aesGcmDecrypt(vaultKey, parsedBlob);
              // runtime.sendMessage JSON-serializes, which drops ArrayBuffers —
              // return base64 and let the caller decode.
              sendResponse({ ok: true, plaintextB64: toBase64(plaintextBytes) });
              return;
            }

            // -----------------------------------------------------------
            // Capture queue (form-submit interceptor)
            // -----------------------------------------------------------
            case "loginSubmitted": {
              pruneStaleCaptures();
              const capture: CapturedLogin = {
                id: makeCaptureId(),
                url: String(message.url ?? ""),
                username: String(message.username ?? ""),
                password: String(message.password ?? ""),
                capturedAt: Date.now(),
              };
              capturedLogins.push(capture);
              while (capturedLogins.length > CAPTURE_MAX) {
                capturedLogins.shift();
              }
              await showCaptureNotification(capture.url, capture.username);
              sendResponse({ ok: true, id: capture.id });
              return;
            }

            case "getCapturedLogins": {
              pruneStaleCaptures();
              // Return shallow copies without the password field unless the
              // popup explicitly requests a specific capture.
              sendResponse({
                ok: true,
                captures: capturedLogins.map((capture) => ({
                  id: capture.id,
                  url: capture.url,
                  username: capture.username,
                  capturedAt: capture.capturedAt,
                })),
              });
              return;
            }

            case "consumeCapturedLogin": {
              pruneStaleCaptures();
              const targetId = message.id as string;
              const index = capturedLogins.findIndex(
                (capture) => capture.id === targetId,
              );
              if (index === -1) {
                sendResponse({ ok: false, error: "capture not found" });
                return;
              }
              const [captured] = capturedLogins.splice(index, 1);
              try {
                await browser.action.setBadgeText({
                  text: capturedLogins.length
                    ? String(capturedLogins.length)
                    : "",
                });
              } catch {
                // swallow — badge API optional
              }
              sendResponse({ ok: true, capture: captured });
              return;
            }

            // -----------------------------------------------------------
            // Passive form-detected ping (kept for visual feedback)
            // -----------------------------------------------------------
            case "loginFormDetected": {
              devLog("login form detected", message.url);
              sendResponse({ ok: true });
              return;
            }

            // -----------------------------------------------------------
            // WebAuthn relay (v1 observer — see webauthn-relay.ts)
            // -----------------------------------------------------------
            case "webauthnObserved": {
              devLog(
                "webauthn call observed",
                message.method,
                message.origin,
              );
              sendResponse({ ok: true });
              return;
            }

            default: {
              sendResponse({ error: `unknown message type: ${message.type}` });
              return;
            }
          }
        } catch (err) {
          sendResponse({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();

      return true; // keep the message channel open for async sendResponse
    },
  );

  devLog("background service worker started");
});
