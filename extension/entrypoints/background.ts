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
  pad,
  unpad,
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
  genHistory = [];
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
// Settings (persisted in storage.local; configurable from the popup)
// ===========================================================================

interface ExtSettings {
  autofill: boolean; // fill credentials on page load without a click
  fieldIcon: boolean; // show the inline vaultctl icon inside login fields
  savePrompt: boolean; // offer to save/update after a login submit
  toastMs: number; // auto-dismiss timeout for toasts (ms)
  suggestPassword: boolean; // suggest a strong password on new-password fields
  genLength: number;
  genLower: boolean;
  genUpper: boolean;
  genDigits: boolean;
  genSymbols: boolean;
  historyMax: number; // how many generated passwords to keep
  historyTtlMin: number; // how long a generated password stays in history (minutes)
}

const DEFAULT_SETTINGS: ExtSettings = {
  autofill: false,
  fieldIcon: true,
  savePrompt: true,
  toastMs: 8000,
  suggestPassword: true,
  genLength: 20,
  genLower: true,
  genUpper: true,
  genDigits: true,
  genSymbols: true,
  historyMax: 5,
  historyTtlMin: 60,
};

// ===========================================================================
// Strong-password generation + ephemeral generated-password history
// ===========================================================================

const GEN_LOWER = "abcdefghijkmnopqrstuvwxyz";
const GEN_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const GEN_DIGITS = "23456789";
const GEN_SYMBOLS = "!@#$%^&*()-_=+[]{}";

function generatePassword(cfg: ExtSettings): string {
  let charset = "";
  if (cfg.genLower) charset += GEN_LOWER;
  if (cfg.genUpper) charset += GEN_UPPER;
  if (cfg.genDigits) charset += GEN_DIGITS;
  if (cfg.genSymbols) charset += GEN_SYMBOLS;
  if (!charset) charset = GEN_LOWER + GEN_UPPER + GEN_DIGITS;
  const length = Math.min(128, Math.max(8, cfg.genLength || 20));
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (v) => charset[v % charset.length]).join("");
}

interface GenEntry {
  id: string;
  password: string;
  createdAt: number;
}

// Generated-password history lives only in memory (never written to disk) and
// is wiped on lock, so plaintext generated passwords never persist.
let genHistory: GenEntry[] = [];

async function pruneGenHistory(): Promise<void> {
  const { historyMax, historyTtlMin } = await getSettings();
  const cutoff = Date.now() - historyTtlMin * 60_000;
  genHistory = genHistory
    .filter((e) => e.createdAt >= cutoff)
    .slice(-Math.max(0, historyMax));
}

async function getSettings(): Promise<ExtSettings> {
  const stored = await browser.storage.local.get("vaultctl_settings");
  return {
    ...DEFAULT_SETTINGS,
    ...((stored.vaultctl_settings as Partial<ExtSettings>) ?? {}),
  };
}

// ===========================================================================
// Authenticated API access + item encryption (mirrors the web client)
// ===========================================================================

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function getServerUrl(): Promise<string> {
  const stored = await browser.storage.local.get("vaultctl_server_url");
  return ((stored.vaultctl_server_url as string) ?? "").replace(/\/$/, "");
}

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  const base = await getServerUrl();
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function encName(vaultId: string, name: string): Promise<string> {
  const key = getVaultKey(vaultId);
  return toBase64(serializeBlob(await aesGcmEncrypt(key, pad(encoder.encode(name)))));
}

async function encData(vaultId: string, obj: unknown): Promise<string> {
  const key = getVaultKey(vaultId);
  return toBase64(
    serializeBlob(await aesGcmEncrypt(key, encoder.encode(JSON.stringify(obj)))),
  );
}

async function decName(vaultId: string, b64: string): Promise<string> {
  const key = getVaultKey(vaultId);
  return decoder.decode(unpad(await aesGcmDecrypt(key, parseBlob(fromBase64(b64)))));
}

async function decData(vaultId: string, b64: string): Promise<Record<string, unknown>> {
  const key = getVaultKey(vaultId);
  const text = decoder.decode(await aesGcmDecrypt(key, parseBlob(fromBase64(b64))));
  return JSON.parse(text) as Record<string, unknown>;
}

// ===========================================================================
// Login-item matching (for autofill + save/update decisions)
// ===========================================================================

interface LoginEntry {
  vaultId: string;
  itemId: string;
  name: string;
  username: string;
  password: string;
  uri: string;
  host: string;
}

let itemsCache: { at: number; entries: LoginEntry[] } | null = null;
const ITEMS_CACHE_MS = 15_000;

function invalidateItemsCache(): void {
  itemsCache = null;
}

async function loadLoginEntries(): Promise<LoginEntry[]> {
  if (itemsCache && Date.now() - itemsCache.at < ITEMS_CACHE_MS) {
    return itemsCache.entries;
  }
  const entries: LoginEntry[] = [];
  for (const vaultId of vaultKeys.keys()) {
    let res: Response;
    try {
      res = await apiFetch(`/api/v1/vaults/${vaultId}/items`, { method: "GET" });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const items = (await res.json()) as Array<{
      id: string;
      itemType: string;
      encryptedName: string;
      encryptedData: string;
      trashed: boolean;
    }>;
    for (const it of items) {
      if (it.trashed || it.itemType !== "login") continue;
      try {
        const data = await decData(vaultId, it.encryptedData);
        const uri = String(data.uri ?? "");
        let name = "";
        try {
          name = await decName(vaultId, it.encryptedName);
        } catch {
          name = safeHostname(uri);
        }
        entries.push({
          vaultId,
          itemId: it.id,
          name,
          username: String(data.username ?? ""),
          password: String(data.password ?? ""),
          uri,
          host: safeHostname(uri),
        });
      } catch {
        // skip items that fail to decrypt or parse
      }
    }
  }
  itemsCache = { at: Date.now(), entries };
  return entries;
}

function hostMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

async function matchesForOrigin(origin: string): Promise<LoginEntry[]> {
  const host = safeHostname(origin);
  return (await loadLoginEntries()).filter((e) => hostMatches(e.host, host));
}

interface SaveDecision {
  action: "none" | "add" | "update";
  vaultId?: string;
  itemId?: string;
  name?: string;
}

async function decideSave(
  origin: string,
  username: string,
  password: string,
): Promise<SaveDecision> {
  const matches = await matchesForOrigin(origin);
  if (matches.some((m) => m.username === username && m.password === password)) {
    return { action: "none" };
  }
  const sameUser = matches.find((m) => m.username === username);
  if (sameUser) {
    return {
      action: "update",
      vaultId: sameUser.vaultId,
      itemId: sameUser.itemId,
      name: sameUser.name,
    };
  }
  return { action: "add" };
}

async function createLogin(
  host: string,
  username: string,
  password: string,
  uri: string,
): Promise<void> {
  const vaultId = [...vaultKeys.keys()][0];
  if (!vaultId) throw new Error("no vault available");
  const body = {
    itemType: "login",
    encryptedName: await encName(vaultId, host || safeHostname(uri)),
    encryptedData: await encData(vaultId, { username, password, uri }),
    favorite: false,
    reprompt: false,
  };
  const res = await apiFetch(`/api/v1/vaults/${vaultId}/items`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`create failed: ${res.status}`);
  invalidateItemsCache();
}

async function updateLogin(
  vaultId: string,
  itemId: string,
  username: string,
  password: string,
): Promise<void> {
  const res = await apiFetch(`/api/v1/vaults/${vaultId}/items/${itemId}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const it = (await res.json()) as {
    encryptedName: string;
    encryptedData: string;
    favorite: boolean;
    reprompt: boolean;
  };
  const data = await decData(vaultId, it.encryptedData);
  data.username = username;
  data.password = password;
  const body = {
    encryptedName: it.encryptedName,
    encryptedData: await encData(vaultId, data),
    favorite: it.favorite,
    reprompt: it.reprompt,
  };
  const put = await apiFetch(`/api/v1/vaults/${vaultId}/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!put.ok) throw new Error(`update failed: ${put.status}`);
  invalidateItemsCache();
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

            // -----------------------------------------------------------
            // Settings
            // -----------------------------------------------------------
            case "getSettings": {
              sendResponse({ ok: true, settings: await getSettings() });
              return;
            }

            case "setSettings": {
              const incoming = (message.settings as Partial<ExtSettings>) ?? {};
              const merged = { ...(await getSettings()), ...incoming };
              await browser.storage.local.set({ vaultctl_settings: merged });
              sendResponse({ ok: true, settings: merged });
              return;
            }

            // -----------------------------------------------------------
            // Autofill + save flow (content script)
            // -----------------------------------------------------------
            case "matchCredentials": {
              const settings = await getSettings();
              if (!stretchedKey) {
                sendResponse({ ok: true, settings, matches: [] });
                return;
              }
              const matches = await matchesForOrigin(String(message.origin ?? ""));
              sendResponse({
                ok: true,
                settings,
                // Never ship passwords until an explicit fill is requested.
                matches: matches.map((m) => ({
                  vaultId: m.vaultId,
                  itemId: m.itemId,
                  name: m.name,
                  username: m.username,
                })),
              });
              return;
            }

            case "fillCredential": {
              const vaultId = String(message.vaultId ?? "");
              const itemId = String(message.itemId ?? "");
              const entry = (await loadLoginEntries()).find(
                (e) => e.vaultId === vaultId && e.itemId === itemId,
              );
              if (!entry) {
                sendResponse({ ok: false, error: "not found" });
                return;
              }
              sendResponse({
                ok: true,
                username: entry.username,
                password: entry.password,
              });
              return;
            }

            case "saveDecision": {
              if (!stretchedKey) {
                sendResponse({ ok: true, action: "none" });
                return;
              }
              const decision = await decideSave(
                String(message.origin ?? ""),
                String(message.username ?? ""),
                String(message.password ?? ""),
              );
              sendResponse({ ok: true, ...decision });
              return;
            }

            case "commitSave": {
              const action = String(message.action ?? "");
              try {
                if (action === "add") {
                  await createLogin(
                    String(message.host ?? ""),
                    String(message.username ?? ""),
                    String(message.password ?? ""),
                    String(message.uri ?? ""),
                  );
                } else if (action === "update") {
                  await updateLogin(
                    String(message.vaultId ?? ""),
                    String(message.itemId ?? ""),
                    String(message.username ?? ""),
                    String(message.password ?? ""),
                  );
                }
                sendResponse({ ok: true });
              } catch (err) {
                sendResponse({
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
              return;
            }

            // -----------------------------------------------------------
            // Strong-password suggestions + history
            // -----------------------------------------------------------
            case "generatePassword": {
              const cfg = await getSettings();
              sendResponse({ ok: true, password: generatePassword(cfg) });
              return;
            }

            case "logGeneratedPassword": {
              const password = String(message.password ?? "");
              if (password) {
                genHistory.push({
                  id: makeCaptureId(),
                  password,
                  createdAt: Date.now(),
                });
                await pruneGenHistory();
              }
              sendResponse({ ok: true });
              return;
            }

            case "getGenHistory": {
              await pruneGenHistory();
              sendResponse({ ok: true, entries: genHistory });
              return;
            }

            case "clearGenHistory": {
              genHistory = [];
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
