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
import { generateSecret, type GenMode } from "../utils/password-gen";
import { parseTotp, generateTotp, secondsRemaining } from "@shared/totp";
import { breachCount } from "../utils/password-health";
import { safeHost, safeHostname, hostMatches, domainMatches } from "../utils/host";
import type { CreditCardData, IdentityData } from "../utils/form-fields";

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
  // "login" captures carry a username/password; "credit_card" and "identity"
  // captures carry a pre-built, web-compatible data payload and a title. The
  // field is optional so older persisted login captures (no kind) still read as
  // logins after a worker recycle.
  kind?: "login" | "credit_card" | "identity";
  url: string;
  username: string;
  password: string;
  // Pre-classified card/identity payload + the masked title to show. Only set
  // for credit_card / identity captures.
  cardData?: CreditCardData;
  identityData?: IdentityData;
  title?: string;
  capturedAt: number;
  read: boolean;
  // The tab that submitted the login. The save toast is only re-opened on a
  // fresh load IN THIS TAB, so an unrelated same-host navigation in another tab
  // within the redirect window can never re-trigger the prompt.
  tabId?: number;
  // How many times the in-page save toast has been re-opened on a fresh page
  // load after the submit. Bounds re-prompting so a redirect re-shows the toast
  // without it reappearing on every later navigation.
  reprompts?: number;
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
// A submit that redirects tears down the content script before the save toast
// can be acted on. Within this window after the submit, the next page load
// re-opens the toast so the user still gets a chance to save on the page they
// land on; REOPEN_MAX bounds it so it does not nag on later navigation.
const PROMPT_REOPEN_MS = 60 * 1000;
const REOPEN_MAX = 2;
// Fixed dot count for the autofill picker's password mask. A constant avoids
// leaking the stored password's real length to the page.
const MASK_DOT_COUNT = 8;

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let stretchedKey: Uint8Array | null = null;
let rsaPrivateKey: CryptoKey | null = null;
const identityKey: { value: CryptoKey | null } = { value: null };
const vaultKeys = new Map<string, Uint8Array>();
const vaultMeta = new Map<string, { name: string; type: string }>();

const capturedLogins: CapturedLogin[] = [];

let autoLockTimer: ReturnType<typeof setTimeout> | undefined;
let autoLockMs = AUTO_LOCK_MS; // configurable; loaded from settings
let unlocked = false; // true once keys are loaded (incl. rehydrated)

// Memory-only session storage (cleared on browser close, never on disk) lets
// the unlocked state survive MV3 service-worker restarts, so the vault does
// not lock at random when Chrome recycles the worker.
const SESSION_KEY = "vaultctl_unlocked";
const EXPIRY_KEY = "vaultctl_unlock_expiry";
// The captured-login queue lives in memory-only session storage (never on
// disk, cleared on browser close) so it survives MV3 service-worker restarts.
// Without this the queue and the persistent toolbar badge drift apart whenever
// Chrome recycles the worker, and clear/mark-read state is silently lost.
const CAPTURES_KEY = "vaultctl_captures";

// ===========================================================================
// Helpers
// ===========================================================================

function devLog(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log("[vaultctl:bg]", ...args);
  }
}

async function persistSession(): Promise<void> {
  if (!unlocked) return;
  const vk: Record<string, number[]> = {};
  for (const [id, key] of vaultKeys) vk[id] = Array.from(key);
  await browser.storage.session.set({
    [SESSION_KEY]: {
      accessToken,
      refreshToken,
      vaultKeys: vk,
      vaultMeta: [...vaultMeta.entries()],
    },
    [EXPIRY_KEY]: autoLockMs > 0 ? Date.now() + autoLockMs : 0, // 0 = never
  });
}

async function rehydrateSession(): Promise<void> {
  try {
    const settings = await getSettings();
    autoLockMs = Math.max(0, settings.autoLockMin) * 60 * 1000;
    const stored = await browser.storage.session.get([SESSION_KEY, EXPIRY_KEY]);
    const expiry = stored[EXPIRY_KEY] as number | undefined;
    const blob = stored[SESSION_KEY] as
      | {
          accessToken: string | null;
          refreshToken?: string | null;
          vaultKeys: Record<string, number[]>;
          vaultMeta: [string, { name: string; type: string }][];
        }
      | undefined;
    if (!blob) return;
    if (expiry && expiry !== 0 && Date.now() > expiry) {
      await doLockAsync();
      return;
    }
    accessToken = blob.accessToken;
    refreshToken = blob.refreshToken ?? null;
    vaultKeys.clear();
    for (const [id, arr] of Object.entries(blob.vaultKeys)) {
      vaultKeys.set(id, Uint8Array.from(arr));
    }
    vaultMeta.clear();
    for (const [id, meta] of blob.vaultMeta) vaultMeta.set(id, meta);
    unlocked = true;
    resetAutoLock();
  } catch {
    // No session to restore; stay locked.
  }
}

function resetAutoLock(): void {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (autoLockMs <= 0) {
    void persistSession(); // never auto-lock, but keep the session warm
    return;
  }
  autoLockTimer = setTimeout(() => doLock(), autoLockMs);
  void persistSession();
}

async function doLockAsync(): Promise<void> {
  try {
    await browser.storage.session.remove([SESSION_KEY, EXPIRY_KEY]);
  } catch {
    // ignore
  }
}

function doLock(): void {
  accessToken = null;
  refreshToken = null;
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
  pendingUsernames.clear();
  breachCache.clear();
  unlocked = false;
  void doLockAsync();
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = undefined;
  }
  browser.runtime.sendMessage({ type: "locked" }).catch(() => {});
}

// Tabs opened while the vault was locked fetched their matches against an
// empty vault; without this nudge they show no icons or autofill until a
// manual reload. Tabs without the content script reject - ignore them.
function notifyTabsUnlocked(): void {
  void browser.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      browser.tabs.sendMessage(tab.id, { type: "vaultUnlocked" }).catch(() => {});
    }
  });
}

function pruneStaleCaptures(): void {
  const cutoff = Date.now() - CAPTURE_TTL_MS;
  while (capturedLogins.length && capturedLogins[0]!.capturedAt < cutoff) {
    capturedLogins.shift();
  }
}

async function persistCaptures(): Promise<void> {
  try {
    await browser.storage.session.set({ [CAPTURES_KEY]: capturedLogins });
  } catch {
    // session storage optional across browsers
  }
}

async function rehydrateCaptures(): Promise<void> {
  try {
    const stored = await browser.storage.session.get(CAPTURES_KEY);
    const saved = stored[CAPTURES_KEY] as CapturedLogin[] | undefined;
    if (Array.isArray(saved)) {
      capturedLogins.length = 0;
      capturedLogins.push(...saved);
      pruneStaleCaptures();
    }
  } catch {
    // nothing to restore
  }
}

// Single write-through point for every capture mutation: prune expired entries,
// persist the queue so it survives a worker restart, then point the action
// badge at the number of UNREAD captures. Because the queue is now durable, the
// badge can never show a phantom count and clear/mark-read state always sticks.
async function syncBadge(): Promise<void> {
  pruneStaleCaptures();
  await persistCaptures();
  const unread = capturedLogins.reduce((n, c) => (c.read ? n : n + 1), 0);
  try {
    await browser.action.setBadgeText({ text: unread ? String(unread) : "" });
    if (unread) {
      await browser.action.setBadgeBackgroundColor({ color: "#2563eb" });
    }
  } catch {
    // swallow - badge API optional across browsers
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
      iconUrl: (browser.runtime.getURL as (p: string) => string)(
        "/icon/icon-128.png",
      ),
      title: "Save to vaultctl?",
      message: `Capture login for ${username || "(no username)"} on ${hostname}`,
    });
  } catch {
    // Notifications may fail if the icon path is absent or permission
    // was denied; fall back to the action badge.
  }
  await syncBadge();
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

// Which update severities raise the in-popup "update available" alert. Mirrors
// the web client's NotifyLevel (vaultctl_update_notify_level). Default "all"
// means: with no preference set, the update is shown.
type UpdateNotifyLevel = "all" | "minor" | "major" | "off";

interface ExtSettings {
  autofill: boolean; // fill credentials on page load without a click
  fieldIcon: boolean; // show the inline vaultctl icon inside login fields
  showWhenLocked: boolean; // show the field icon even while locked (click to sign in)
  savePrompt: boolean; // offer to save/update after a login submit
  toastMs: number; // auto-dismiss timeout for toasts (ms)
  relaxedMatch: boolean; // match credentials by registrable domain, not exact host
  breachCheck: boolean; // check passwords against HIBP (k-anonymity, opt-in)
  suggestPassword: boolean; // suggest a strong password on new-password fields
  updateNotify: UpdateNotifyLevel; // which update severities raise the alert
  genMode: GenMode; // "password" (random charset) or "passphrase" (memorable)
  genLength: number;
  genLower: boolean;
  genUpper: boolean;
  genDigits: boolean;
  genSymbols: boolean;
  genWords: number; // passphrase word count
  genWordSep: string; // passphrase word separator
  genWordCaps: boolean; // capitalise each passphrase word
  genWordDigit: boolean; // append a number to the passphrase
  historyMax: number; // how many generated passwords to keep
  historyTtlMin: number; // how long a generated password stays in history (minutes)
  autoLockMin: number; // minutes of inactivity before locking (0 = never)
}

const DEFAULT_SETTINGS: ExtSettings = {
  autofill: false,
  fieldIcon: true,
  showWhenLocked: true,
  savePrompt: true,
  toastMs: 8000,
  relaxedMatch: false,
  breachCheck: false,
  suggestPassword: true,
  updateNotify: "all",
  genMode: "password",
  genLength: 20,
  genLower: true,
  genUpper: true,
  genDigits: true,
  genSymbols: true,
  genWords: 4,
  genWordSep: "-",
  genWordCaps: true,
  genWordDigit: true,
  historyMax: 5,
  historyTtlMin: 60,
  autoLockMin: 0,
};

// ===========================================================================
// Strong-password generation + ephemeral generated-password history
// ===========================================================================

interface GenEntry {
  id: string;
  password: string;
  createdAt: number;
}

// Generated-password history lives only in memory (never written to disk) and
// is wiped on lock, so plaintext generated passwords never persist.
let genHistory: GenEntry[] = [];

// Usernames/emails entered in an earlier step of a multi-step login, keyed by
// host, so the password step can be saved with its email. Short-lived.
const PENDING_USERNAME_TTL_MS = 10 * 60 * 1000;
const pendingUsernames = new Map<string, { username: string; at: number }>();

// The remembered email/username for a multi-step login must survive an MV3
// service-worker recycle between the email step and the password step, so it
// lives in memory-only session storage (cleared on browser close), not just
// the in-memory map.
const PENDING_USERNAMES_KEY = "vaultctl_pending_usernames";

async function persistPendingUsernames(): Promise<void> {
  try {
    await browser.storage.session.set({
      [PENDING_USERNAMES_KEY]: [...pendingUsernames.entries()],
    });
  } catch {
    // session storage optional across browsers
  }
}

async function rehydratePendingUsernames(): Promise<void> {
  try {
    const stored = await browser.storage.session.get(PENDING_USERNAMES_KEY);
    const saved = stored[PENDING_USERNAMES_KEY] as
      | [string, { username: string; at: number }][]
      | undefined;
    if (Array.isArray(saved)) {
      for (const [host, entry] of saved) {
        if (Date.now() - entry.at <= PENDING_USERNAME_TTL_MS) {
          pendingUsernames.set(host, entry);
        }
      }
    }
  } catch {
    // nothing to restore
  }
}

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
// Per-site "never save" list (hosts the user opted out of save prompts for).
// Persisted in storage.local so the choice survives a worker recycle.
// ===========================================================================

const NEVER_SAVE_KEY = "vaultctl_never_save_hosts";

async function getNeverSaveHosts(): Promise<string[]> {
  const stored = await browser.storage.local.get(NEVER_SAVE_KEY);
  const hosts = stored[NEVER_SAVE_KEY];
  return Array.isArray(hosts) ? (hosts as string[]) : [];
}

async function isNeverSaveHost(host: string): Promise<boolean> {
  if (!host) return false;
  const hosts = await getNeverSaveHosts();
  return hosts.some((h) => hostMatches(h, host));
}

async function addNeverSaveHost(host: string): Promise<void> {
  if (!host) return;
  const hosts = await getNeverSaveHosts();
  if (hosts.some((h) => hostMatches(h, host))) return;
  hosts.push(host);
  await browser.storage.local.set({ [NEVER_SAVE_KEY]: hosts });
}

async function removeNeverSaveHost(host: string): Promise<void> {
  const hosts = (await getNeverSaveHosts()).filter((h) => h !== host);
  await browser.storage.local.set({ [NEVER_SAVE_KEY]: hosts });
}

// ===========================================================================
// Active vault (the default save target + the vault the popup list shows).
// Persisted in storage.local so the choice survives popup close and worker
// recycle; falls back to the first unlocked vault when unset or stale.
// ===========================================================================

const ACTIVE_VAULT_KEY = "vaultctl_active_vault";

function firstVaultId(): string | undefined {
  return [...vaultKeys.keys()][0];
}

async function getActiveVaultId(): Promise<string | undefined> {
  const fallback = firstVaultId();
  const stored = await browser.storage.local.get(ACTIVE_VAULT_KEY);
  const saved = stored[ACTIVE_VAULT_KEY] as string | undefined;
  if (saved && vaultKeys.has(saved)) return saved;
  return fallback;
}

async function setActiveVaultId(vaultId: string): Promise<boolean> {
  if (!vaultKeys.has(vaultId)) return false;
  await browser.storage.local.set({ [ACTIVE_VAULT_KEY]: vaultId });
  return true;
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

// Exchange the (rotating) refresh token for a fresh access token. The access
// token has a short TTL (~15m); without this the extension would 401 and force
// a full re-login long before the auto-lock period. Single-flighted so parallel
// requests share one refresh.
async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const base = await getServerUrl();
      const res = await fetch(`${base}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (!data.accessToken) return false;
      accessToken = data.accessToken;
      if (data.refreshToken) refreshToken = data.refreshToken;
      await persistSession();
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  const base = await getServerUrl();
  const send = () =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  let res = await send();
  if (res.status === 401 && refreshToken && (await refreshAccessToken())) {
    res = await send();
  }
  return res;
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
  totp: string;
}

let itemsCache: { at: number; entries: LoginEntry[] } | null = null;
const ITEMS_CACHE_MS = 15_000;

function invalidateItemsCache(): void {
  itemsCache = null;
  fillableCache = null;
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
          host: safeHost(uri),
          totp: String(data.totp ?? ""),
        });
      } catch {
        // skip items that fail to decrypt or parse
      }
    }
  }
  itemsCache = { at: Date.now(), entries };
  return entries;
}

async function matchesForOrigin(origin: string): Promise<LoginEntry[]> {
  const host = safeHost(origin);
  const { relaxedMatch } = await getSettings();
  const entries = await loadLoginEntries();
  return entries.filter((e) =>
    relaxedMatch ? domainMatches(e.host, host) : hostMatches(e.host, host),
  );
}

// HIBP breach results cached by password so the picker's compromised flag
// doesn't re-hit the network on every match. Cleared on lock so no plaintext
// password lingers as a cache key longer than the session.
const breachCache = new Map<string, { breached: boolean; at: number }>();
const BREACH_CACHE_MS = 60 * 60 * 1000;

async function isPasswordBreached(password: string): Promise<boolean> {
  if (!password) return false;
  const cached = breachCache.get(password);
  if (cached && Date.now() - cached.at < BREACH_CACHE_MS) return cached.breached;
  const breached = (await breachCount(password)) > 0;
  breachCache.set(password, { breached, at: Date.now() });
  return breached;
}

// ===========================================================================
// Credit-card / identity items (for user-initiated fill)
//
// Unlike logins, cards and identities have no host binding: the user fills them
// wherever they explicitly pick from our picker. The list response is masked
// (no full number, no cvv) - the secrets only leave the worker on an explicit
// single-item fill request, mirroring fillCredential.
// ===========================================================================

interface CardEntry {
  vaultId: string;
  itemId: string;
  name: string;
  data: Record<string, unknown>;
}

interface IdentityEntry {
  vaultId: string;
  itemId: string;
  name: string;
  data: Record<string, unknown>;
}

let fillableCache: {
  at: number;
  cards: CardEntry[];
  identities: IdentityEntry[];
} | null = null;
const FILLABLE_CACHE_MS = 15_000;

async function loadFillableEntries(): Promise<{
  cards: CardEntry[];
  identities: IdentityEntry[];
}> {
  if (fillableCache && Date.now() - fillableCache.at < FILLABLE_CACHE_MS) {
    return { cards: fillableCache.cards, identities: fillableCache.identities };
  }
  const cards: CardEntry[] = [];
  const identities: IdentityEntry[] = [];
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
      if (it.trashed) continue;
      if (it.itemType !== "credit_card" && it.itemType !== "identity") continue;
      try {
        const data = await decData(vaultId, it.encryptedData);
        let name = "";
        try {
          name = await decName(vaultId, it.encryptedName);
        } catch {
          name = it.itemType === "credit_card" ? "Card" : "Identity";
        }
        const entry = { vaultId, itemId: it.id, name, data };
        if (it.itemType === "credit_card") cards.push(entry);
        else identities.push(entry);
      } catch {
        // skip items that fail to decrypt or parse
      }
    }
  }
  fillableCache = { at: Date.now(), cards, identities };
  return { cards, identities };
}

// ===========================================================================
// Update check - compares THIS extension's version against the latest release
// the server reports (GET /api/v1/updates), so "update available" reflects the
// installed extension, not the server.
// ===========================================================================

function parseSemver(v: string): [number, number, number] | null {
  const core = v.replace(/^v/, "").split(/[-+]/)[0] ?? "";
  const parts = core.split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function semverSeverity(current: string, latest: string): string {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return "";
  if (l[0] > c[0]) return "major";
  if (l[0] < c[0]) return "none";
  if (l[1] > c[1]) return "minor";
  if (l[1] < c[1]) return "none";
  if (l[2] > c[2]) return "patch";
  return "none";
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
  const sameUser = username
    ? matches.find((m) => m.username === username)
    : undefined;
  if (sameUser) {
    return {
      action: "update",
      vaultId: sameUser.vaultId,
      itemId: sameUser.itemId,
      name: sameUser.name,
    };
  }
  // A change-password / reset form carries no username (you're already signed
  // in, or arrived via an email link). If exactly one credential is stored for
  // this host, offer to UPDATE its password rather than creating a junk entry
  // with an empty username.
  if (!username && matches.length === 1) {
    const only = matches[0]!;
    if (only.password === password) return { action: "none" };
    return {
      action: "update",
      vaultId: only.vaultId,
      itemId: only.itemId,
      name: only.name,
    };
  }
  return { action: "add" };
}

async function createLogin(
  host: string,
  username: string,
  password: string,
  uri: string,
  targetVaultId?: string,
  name?: string,
): Promise<void> {
  const vaultId =
    targetVaultId && vaultKeys.has(targetVaultId)
      ? targetVaultId
      : (await getActiveVaultId());
  if (!vaultId) throw new Error("no vault available");
  const body = {
    itemType: "login",
    encryptedName: await encName(vaultId, name || host || safeHostname(uri)),
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

// Persist a pre-built credit_card / identity payload as a new vault item. The
// payload is already in the exact web-editor JSON shape, so it round-trips with
// the web credit-card / identity editors. encryptedName is the masked title
// (card: brand + last4; identity: full name).
async function createItem(
  itemType: "credit_card" | "identity",
  title: string,
  data: unknown,
  targetVaultId?: string,
): Promise<void> {
  const vaultId =
    targetVaultId && vaultKeys.has(targetVaultId)
      ? targetVaultId
      : await getActiveVaultId();
  if (!vaultId) throw new Error("no vault available");
  const body = {
    itemType,
    encryptedName: await encName(vaultId, title || itemType),
    encryptedData: await encData(vaultId, data),
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
  // A password-change capture carries no username; keep the stored one rather
  // than blanking it.
  if (username) data.username = username;
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

  unlocked = true;
  await persistSession();
  devLog("initialised", vaultKeys.size, "vault keys");
}

// ===========================================================================
// Sender validation
// ===========================================================================

// The content script matches <all_urls>, so a privileged message could
// originate from any web page. Only a narrow autofill/capture set is reachable
// from a content script; everything that returns plaintext, touches key
// material, mutates the vault, or mutates the capture queue is reachable only
// from the extension's own pages (popup / options), which have no sender.tab.
const CONTENT_SCRIPT_ALLOWED = new Set<string>([
  "loginSubmitted",
  "getPendingPrompt",
  "matchCredentials",
  "fillCredential",
  // Generate a 2FA code for a host-matched login. Returns only the short-lived
  // code (never the TOTP secret), gated by the same origin check as fillCredential.
  "generateTotp",
  "saveDecision",
  "rememberUsername",
  "getRememberedUsername",
  "generatePassword",
  "logGeneratedPassword",
  "loginFormDetected",
  "webauthnObserved",
  // Open the configured web vault in a new tab (no secret crosses the boundary;
  // the background just reads the stored server URL it already holds).
  "openWebVault",
  // Open the extension popup as a window so the user can sign in / unlock after
  // clicking the in-page icon while the vault is locked. Opens the extension's
  // own page; no secret or key material crosses the boundary.
  "openUnlock",
  // The in-page save toast's Save / Not-now buttons act on a capture the user
  // just submitted. Neither returns plaintext or key material - the dangerous
  // capture mutations (clear/dismiss/markAll) and every read stay page-only.
  "saveCapturedLogin",
  "markCaptureRead",
  // "Never for this site" from the in-page toast. The host is taken from
  // sender.tab.url, so a page can only ever opt ITSELF out.
  "neverSaveHost",
  // Card/identity capture-on-submit, mirroring loginSubmitted: the content
  // script hands over a pre-classified payload to queue. The response carries no
  // secret (only an id + title), so this is no more privileged than loginSubmitted.
  "captureItemSubmitted",
  // List the user's cards/identities for the in-page picker. The response is
  // MASKED (last4 / city only, never the full number or cvv), exactly like
  // matchCredentials masks the password, so it leaks no secret.
  "listFillItems",
  // Single-item fill for an explicit user click in OUR picker. Returns the one
  // requested field value (incl. full number / cvv) only on this explicit
  // request, mirroring how fillCredential returns the password.
  "fillItemField",
]);

// A content script always carries a sender.tab; the popup / extension pages do
// not. A genuine same-extension message also has sender.id === runtime.id.
function isFromContentScript(sender: Browser.runtime.MessageSender): boolean {
  return sender.tab !== undefined;
}

function isFromExtension(sender: Browser.runtime.MessageSender): boolean {
  return sender.id === browser.runtime.id;
}

// ===========================================================================
// Message handler
// ===========================================================================

export default defineBackground(() => {
  // Restore the unlocked state and the captured-login queue if the worker was
  // recycled mid-session, so neither the vault nor the alerts reset at random.
  const rehydrated = Promise.all([
    rehydrateSession(),
    rehydrateCaptures(),
    rehydratePendingUsernames(),
  ]);

  // After the browser auto-updates the extension, remember the new version so
  // the popup can show a one-time "what's new", and surface a desktop alert.
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "update") return;
    const version = browser.runtime.getManifest().version;
    void browser.storage.local.set({ vaultctl_whatsnew_version: version });
    try {
      const iconUrl = (browser.runtime.getURL as (p: string) => string)(
        "/icon/icon-128.png",
      );
      void browser.notifications?.create?.(`vaultctl-update-${version}`, {
        type: "basic",
        iconUrl,
        title: "vaultctl updated",
        message: `Updated to v${version}. Open vaultctl to see what's new.`,
      });
    } catch {
      // notifications are best-effort
    }
  });

  // Tell the active tab's content script to open the fill picker on whatever
  // field has focus. Backs both the right-click menu and the keyboard command.
  const requestFillOnActiveTab = () => {
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId === undefined) return;
        void browser.tabs
          .sendMessage(tabId, { type: "openFillPicker" })
          .catch(() => {
            // No content script on this page (e.g. a chrome:// tab) - ignore.
          });
      });
  };

  // Register a right-click "Fill from vaultctl" item on editable fields.
  // removeAll-then-create keeps it idempotent across service-worker restarts.
  try {
    browser.contextMenus?.removeAll?.(() => {
      browser.contextMenus?.create?.({
        id: "vaultctl-fill",
        title: "Fill from vaultctl",
        contexts: ["editable"],
      });
    });
    browser.contextMenus?.onClicked.addListener((info) => {
      if (info.menuItemId === "vaultctl-fill") requestFillOnActiveTab();
    });
  } catch {
    // contextMenus is optional across browsers
  }

  browser.commands?.onCommand.addListener((command) => {
    if (command === "fill-login") requestFillOnActiveTab();
  });

  browser.runtime.onMessage.addListener(
    (
      rawMessage: unknown,
      sender: Browser.runtime.MessageSender,
      sendResponse: SendResponse,
    ): boolean => {
      const message = rawMessage as IncomingMessage;
      if (!message || typeof message.type !== "string") {
        sendResponse({ error: "invalid message" });
        return false;
      }

      // Reject any message not from this extension, and gate privileged
      // (extension-page-only) messages so a web page's content script can never
      // reach getSession, fillCredential, decryptForVault, listItems, unlock,
      // setToken, or any capture mutation.
      if (!isFromExtension(sender)) {
        sendResponse({ error: "unauthorized sender" });
        return false;
      }
      if (isFromContentScript(sender) && !CONTENT_SCRIPT_ALLOWED.has(message.type)) {
        sendResponse({ error: "message not allowed from this context" });
        return false;
      }

      void (async () => {
        try {
          await rehydrated;
          if (
            message.type !== "getCapturedLogins" &&
            message.type !== "getAuthState" &&
            unlocked
          ) {
            resetAutoLock();
          }
          switch (message.type) {
            // -----------------------------------------------------------
            // Auth / lifecycle
            // -----------------------------------------------------------
            case "getAuthState": {
              sendResponse({
                isAuthenticated: !!accessToken,
                isUnlocked: unlocked,
                vaultCount: vaultKeys.size,
              });
              return;
            }

            case "getSession": {
              // Lets the popup resume after it was closed while the worker
              // stayed unlocked. The token never leaves the extension.
              sendResponse({
                isUnlocked: unlocked,
                accessToken,
                activeVaultId: await getActiveVaultId(),
                vaults: [...vaultMeta.entries()].map(([id, meta]) => ({
                  id,
                  name: meta.name,
                  type: meta.type,
                })),
              });
              return;
            }

            case "getActiveVault": {
              sendResponse({ ok: true, vaultId: await getActiveVaultId() });
              return;
            }

            case "setActiveVault": {
              const ok = await setActiveVaultId(String(message.vaultId ?? ""));
              sendResponse({ ok, vaultId: await getActiveVaultId() });
              return;
            }

            case "setToken": {
              accessToken = (message.token as string) ?? null;
              if (typeof message.refreshToken === "string") {
                refreshToken = message.refreshToken;
              }
              if (unlocked) void persistSession();
              sendResponse({ ok: true });
              return;
            }

            case "unlock": {
              await handleInit(
                message as unknown as Parameters<typeof handleInit>[0],
              );
              resetAutoLock();
              notifyTabsUnlocked();
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
            // Crypto ops - exposed for the popup
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
              // runtime.sendMessage JSON-serializes, which drops ArrayBuffers -
              // return base64 and let the caller decode.
              sendResponse({ ok: true, plaintextB64: toBase64(plaintextBytes) });
              return;
            }

            // -----------------------------------------------------------
            // Capture queue (form-submit interceptor)
            // -----------------------------------------------------------
            case "loginSubmitted": {
              pruneStaleCaptures();
              const url = String(message.url ?? "");
              // Respect a per-site opt-out: never queue a capture (and so never
              // prompt) for a host the user marked "never save".
              if (await isNeverSaveHost(safeHostname(url))) {
                sendResponse({ ok: true, skipped: true });
                return;
              }
              let username = String(message.username ?? "");
              const password = String(message.password ?? "");
              // A password-only step (multi-step login) carries no username;
              // recover the email stashed when the user left the email field.
              if (!username) {
                const pending = pendingUsernames.get(safeHostname(url));
                if (pending && Date.now() - pending.at <= PENDING_USERNAME_TTL_MS) {
                  username = pending.username;
                }
              }
              // Don't queue a capture for a credential already stored exactly
              // as-is; only new or changed logins are worth offering to save.
              let action: "add" | "update" | undefined;
              if (unlocked) {
                const decision = await decideSave(url, username, password);
                if (decision.action === "none") {
                  sendResponse({ ok: true, skipped: true });
                  return;
                }
                action = decision.action;
              }
              const capture: CapturedLogin = {
                id: makeCaptureId(),
                url,
                username,
                password,
                capturedAt: Date.now(),
                read: false,
                tabId: sender.tab?.id,
              };
              capturedLogins.push(capture);
              while (capturedLogins.length > CAPTURE_MAX) {
                capturedLogins.shift();
              }
              // Persist before any further await: a login submit usually
              // redirects, which can evict the MV3 worker before the landing
              // page asks for the pending prompt. Without this write-through the
              // capture lived only in memory and the save toast never reopened.
              await syncBadge();
              await showCaptureNotification(capture.url, capture.username);
              sendResponse({ ok: true, id: capture.id, action, username });
              return;
            }

            case "captureItemSubmitted": {
              pruneStaleCaptures();
              const kind = message.kind === "identity" ? "identity" : "credit_card";
              const url = String(message.url ?? "");
              if (await isNeverSaveHost(safeHostname(url))) {
                sendResponse({ ok: true, skipped: true });
                return;
              }
              const title = String(message.title ?? "");
              const capture: CapturedLogin = {
                id: makeCaptureId(),
                kind,
                url,
                username: "",
                password: "",
                title,
                cardData:
                  kind === "credit_card"
                    ? (message.data as CreditCardData)
                    : undefined,
                identityData:
                  kind === "identity"
                    ? (message.data as IdentityData)
                    : undefined,
                capturedAt: Date.now(),
                read: false,
                tabId: sender.tab?.id,
              };
              capturedLogins.push(capture);
              while (capturedLogins.length > CAPTURE_MAX) {
                capturedLogins.shift();
              }
              // Persist before any further await so a checkout redirect that
              // evicts the worker still leaves the capture for the save toast to
              // reopen on the landing page.
              await syncBadge();
              await showCaptureNotification(
                capture.url,
                title ||
                  (kind === "credit_card" ? "a card" : "an address"),
              );
              sendResponse({ ok: true, id: capture.id, kind, title });
              return;
            }

            case "getCapturedLogins": {
              // Opening the popup reconciles the badge: a capture that aged out
              // is pruned here, so the badge can never outlive its captures.
              await syncBadge();
              // Return shallow copies without the password field unless the
              // popup explicitly requests a specific capture.
              sendResponse({
                ok: true,
                captures: capturedLogins.map((capture) => ({
                  id: capture.id,
                  kind: capture.kind ?? "login",
                  url: capture.url,
                  username: capture.username,
                  // The masked title (card brand + last4 / full name). No secret:
                  // the card number / cvv are never included in this summary.
                  title: capture.title ?? "",
                  capturedAt: capture.capturedAt,
                  read: capture.read,
                })),
              });
              return;
            }

            case "getPendingPrompt": {
              // Re-open the save toast on the page the user lands on after a
              // redirect: return the freshest unsaved capture submitted by THIS
              // tab that is still inside the redirect window and hasn't been
              // exhausted. Scoping to the submitting tab stops an unrelated
              // same-host navigation in another tab from re-triggering it.
              pruneStaleCaptures();
              if (!unlocked) {
                sendResponse({ ok: true });
                return;
              }
              const host = safeHostname(String(message.host ?? ""));
              const requestTabId = sender.tab?.id;
              const now = Date.now();
              const candidate = [...capturedLogins].reverse().find((c) => {
                if (c.read) return false;
                if ((c.reprompts ?? 0) >= REOPEN_MAX) return false;
                if (now - c.capturedAt > PROMPT_REOPEN_MS) return false;
                // A post-login redirect frequently lands on a different
                // host/subdomain (accounts.x -> app.x, login.x -> x), so the
                // capture's host won't equal the landing host. Re-open on the
                // SAME submitting tab regardless of host - the user typed this
                // credential in this tab seconds ago. Fall back to a host match
                // for captures with no tab (restored after a worker restart).
                const sameTab = c.tabId !== undefined && c.tabId === requestTabId;
                const sameHost =
                  c.tabId === undefined && hostMatches(safeHostname(c.url), host);
                return sameTab || sameHost;
              });
              if (!candidate) {
                sendResponse({ ok: true });
                return;
              }
              // Card / identity captures aren't host-deduped; re-open them as-is.
              if (candidate.kind === "credit_card" || candidate.kind === "identity") {
                candidate.reprompts = (candidate.reprompts ?? 0) + 1;
                await persistCaptures();
                sendResponse({
                  ok: true,
                  prompt: {
                    id: candidate.id,
                    kind: candidate.kind,
                    action: "add",
                    host,
                    username: "",
                    title: candidate.title ?? "",
                  },
                });
                return;
              }
              const decision = await decideSave(
                candidate.url,
                candidate.username,
                candidate.password,
              );
              if (decision.action === "none") {
                sendResponse({ ok: true });
                return;
              }
              candidate.reprompts = (candidate.reprompts ?? 0) + 1;
              await persistCaptures();
              sendResponse({
                ok: true,
                prompt: {
                  id: candidate.id,
                  kind: "login",
                  action: decision.action,
                  // Label with the credential's own host, not the landing host,
                  // since a redirect may have crossed to a different host.
                  host: safeHostname(candidate.url),
                  username: candidate.username,
                  title: "",
                },
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
              await syncBadge();
              sendResponse({ ok: true, capture: captured });
              return;
            }

            case "saveCapturedLogin": {
              pruneStaleCaptures();
              const targetId = message.id as string;
              const capture = capturedLogins.find((c) => c.id === targetId);
              if (!capture) {
                sendResponse({ ok: false, error: "capture not found" });
                return;
              }
              if (!unlocked) {
                sendResponse({ ok: false, error: "vault is locked" });
                return;
              }
              // Card / identity captures carry a pre-built, web-compatible
              // payload; persist it as a new item (no dedupe/update flow - cards
              // and addresses aren't host-keyed the way logins are).
              if (capture.kind === "credit_card" || capture.kind === "identity") {
                try {
                  const targetVaultId =
                    typeof message.vaultId === "string" ? message.vaultId : undefined;
                  // The review toast may pass an edited payload and title.
                  const data =
                    message.data && typeof message.data === "object"
                      ? message.data
                      : capture.kind === "credit_card"
                        ? capture.cardData
                        : capture.identityData;
                  const title =
                    typeof message.title === "string" && message.title
                      ? message.title
                      : capture.title ?? "";
                  await createItem(capture.kind, title, data, targetVaultId);
                  const idx = capturedLogins.findIndex((c) => c.id === targetId);
                  if (idx !== -1) capturedLogins.splice(idx, 1);
                  await syncBadge();
                  sendResponse({ ok: true, action: "add" });
                } catch (err) {
                  sendResponse({
                    ok: false,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
                return;
              }
              try {
                // The save toast may pass an edited username (and name) and a
                // chosen vault. The edited username also steers the decision, so
                // saving as a different account adds instead of silently
                // updating the one that happened to match.
                const editedUsername =
                  typeof message.username === "string"
                    ? message.username
                    : capture.username;
                const editedName =
                  typeof message.name === "string" ? message.name : undefined;
                const decision = await decideSave(
                  capture.url,
                  editedUsername,
                  capture.password,
                );
                if (decision.action === "add") {
                  const targetVaultId =
                    typeof message.vaultId === "string"
                      ? message.vaultId
                      : undefined;
                  await createLogin(
                    safeHostname(capture.url),
                    editedUsername,
                    capture.password,
                    capture.url,
                    targetVaultId,
                    editedName,
                  );
                } else if (decision.action === "update") {
                  await updateLogin(
                    decision.vaultId!,
                    decision.itemId!,
                    capture.username,
                    capture.password,
                  );
                }
                const idx = capturedLogins.findIndex((c) => c.id === targetId);
                if (idx !== -1) capturedLogins.splice(idx, 1);
                await syncBadge();
                sendResponse({ ok: true, action: decision.action });
              } catch (err) {
                sendResponse({
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
              return;
            }

            case "markCaptureRead": {
              const targetId = message.id as string;
              const target = capturedLogins.find((c) => c.id === targetId);
              if (target) target.read = true;
              await syncBadge();
              sendResponse({ ok: true });
              return;
            }

            case "markAllCapturesRead": {
              for (const capture of capturedLogins) capture.read = true;
              await syncBadge();
              sendResponse({ ok: true });
              return;
            }

            case "dismissCapturedLogin": {
              const targetId = message.id as string;
              const index = capturedLogins.findIndex((c) => c.id === targetId);
              if (index !== -1) capturedLogins.splice(index, 1);
              await syncBadge();
              sendResponse({ ok: true });
              return;
            }

            case "clearCapturedLogins": {
              capturedLogins.length = 0;
              await syncBadge();
              sendResponse({ ok: true });
              return;
            }

            // -----------------------------------------------------------
            // Per-site "never save" list
            // -----------------------------------------------------------
            case "neverSaveHost": {
              // A content-script sender can only opt out ITS OWN host (derived
              // from sender.tab.url), so a page can't suppress prompts for an
              // unrelated site; the popup may pass an explicit host.
              const host = isFromContentScript(sender)
                ? safeHostname(sender.tab?.url ?? "")
                : safeHostname(String(message.host ?? ""));
              if (host) {
                await addNeverSaveHost(host);
                // Drop any already-queued captures for this host so the prompt
                // can't reappear after the user opted out.
                for (let i = capturedLogins.length - 1; i >= 0; i--) {
                  if (hostMatches(safeHostname(capturedLogins[i]!.url), host)) {
                    capturedLogins.splice(i, 1);
                  }
                }
                await syncBadge();
              }
              sendResponse({ ok: true, host });
              return;
            }

            case "listNeverSaveHosts": {
              sendResponse({ ok: true, hosts: await getNeverSaveHosts() });
              return;
            }

            case "removeNeverSaveHost": {
              await removeNeverSaveHost(String(message.host ?? ""));
              sendResponse({ ok: true, hosts: await getNeverSaveHosts() });
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

            case "openWebVault": {
              const base = await getServerUrl();
              if (base && /^https?:\/\//i.test(base)) {
                void browser.tabs.create({ url: base });
              }
              sendResponse({ ok: true });
              return;
            }

            case "openUnlock": {
              // Prefer the real toolbar popup: it shares the exact same context
              // as clicking the toolbar icon, so the already-configured server
              // and Touch ID enrollment show (no fresh setup). Some browsers
              // reject openPopup() outside a direct toolbar gesture, so fall
              // back to a popup window - the same extension page against the
              // same storage. Master-password entry stays in this trusted
              // extension page, never in the web page; on unlock,
              // notifyTabsUnlocked() tells the tab to re-match and fill.
              const action = browser.action as unknown as
                | { openPopup?: () => Promise<void> }
                | undefined;
              try {
                if (action?.openPopup) {
                  await action.openPopup();
                  sendResponse({ ok: true });
                  return;
                }
              } catch {
                // openPopup unavailable / rejected - fall through to a window.
              }
              await browser.windows.create({
                url: browser.runtime.getURL("/popup.html"),
                type: "popup",
                width: 400,
                height: 620,
              });
              sendResponse({ ok: true });
              return;
            }

            // -----------------------------------------------------------
            // WebAuthn relay (v1 observer - see webauthn-relay.ts)
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
              // Apply a changed auto-lock period immediately.
              autoLockMs = Math.max(0, merged.autoLockMin) * 60 * 1000;
              if (unlocked) resetAutoLock();
              sendResponse({ ok: true, settings: merged });
              return;
            }

            // -----------------------------------------------------------
            // Autofill + save flow (content script)
            // -----------------------------------------------------------
            case "matchCredentials": {
              const settings = await getSettings();
              // `configured` lets the content script show the locked-state icon
              // only once the extension has been set up (a server URL exists),
              // so a brand-new install stays quiet.
              const configured = (await getServerUrl()).length > 0;
              if (!unlocked) {
                sendResponse({
                  ok: true,
                  settings,
                  matches: [],
                  unlocked: false,
                  configured,
                });
                return;
              }
              const matches = await matchesForOrigin(String(message.origin ?? ""));
              // When the opt-in breach check is on, flag which matches use a
              // compromised password so the picker can warn (cached; no secret
              // leaves the device beyond the k-anonymous HIBP prefix).
              const compromisedFlags = settings.breachCheck
                ? await Promise.all(matches.map((m) => isPasswordBreached(m.password)))
                : matches.map(() => false);
              sendResponse({
                ok: true,
                settings,
                unlocked: true,
                configured,
                // Vault list (id/name/type only) so the save toast can offer a
                // save target. No keys or secrets cross the boundary.
                vaults: [...vaultMeta.entries()].map(([id, meta]) => ({
                  id,
                  name: meta.name,
                  type: meta.type,
                })),
                // Never ship the password itself, nor its real length: the page
                // would learn how long the stored secret is. The picker shows a
                // fixed-width dot mask, so every row carries the same constant.
                matches: matches.map((m, index) => ({
                  vaultId: m.vaultId,
                  itemId: m.itemId,
                  name: m.name,
                  username: m.username,
                  vaultName: vaultMeta.get(m.vaultId)?.name ?? "",
                  passwordLength: MASK_DOT_COUNT,
                  // Flag (never the secret) so the page can offer to fill a 2FA
                  // code when this login carries a TOTP secret.
                  hasTotp: m.totp.trim().length > 0,
                  compromised: compromisedFlags[index] ?? false,
                })),
              });
              return;
            }

            case "checkUpdate": {
              const currentVersion = browser.runtime.getManifest().version;
              const fail = () =>
                sendResponse({
                  ok: true,
                  enabled: false,
                  currentVersion,
                  updateAvailable: false,
                });
              if (!unlocked) {
                fail();
                return;
              }
              try {
                const res = await apiFetch("/api/v1/updates", { method: "GET" });
                if (!res.ok) {
                  fail();
                  return;
                }
                const data = (await res.json()) as {
                  enabled?: boolean;
                  latestVersion?: string;
                  releaseNotes?: string;
                  releaseUrl?: string;
                };
                const latestVersion = data.latestVersion ?? "";
                const severity = semverSeverity(currentVersion, latestVersion);
                sendResponse({
                  ok: true,
                  enabled: !!data.enabled,
                  currentVersion,
                  latestVersion,
                  severity,
                  updateAvailable:
                    severity === "major" || severity === "minor" || severity === "patch",
                  releaseNotes: data.releaseNotes ?? "",
                  releaseUrl: data.releaseUrl ?? "",
                });
              } catch {
                fail();
              }
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
              // Defence in depth: when a content script asks for the plaintext,
              // re-derive the requesting tab's host from sender.tab.url and
              // require it matches the credential's stored host, so a tab can
              // never pull a password for a different origin.
              if (isFromContentScript(sender)) {
                const tabHost = safeHost(sender.tab?.url ?? "");
                const { relaxedMatch } = await getSettings();
                const ok = relaxedMatch
                  ? domainMatches(tabHost, entry.host)
                  : hostMatches(tabHost, entry.host);
                if (!ok) {
                  sendResponse({ ok: false, error: "origin mismatch" });
                  return;
                }
              }
              sendResponse({
                ok: true,
                username: entry.username,
                password: entry.password,
              });
              return;
            }

            case "generateTotp": {
              if (!unlocked) {
                sendResponse({ ok: false, error: "vault is locked" });
                return;
              }
              const vaultId = String(message.vaultId ?? "");
              const itemId = String(message.itemId ?? "");
              const entry = (await loadLoginEntries()).find(
                (e) => e.vaultId === vaultId && e.itemId === itemId,
              );
              if (!entry || !entry.totp.trim()) {
                sendResponse({ ok: false, error: "no totp" });
                return;
              }
              // Same origin guard as fillCredential: a content script can only
              // pull a code for a login whose host matches the requesting tab.
              if (isFromContentScript(sender)) {
                const tabHost = safeHost(sender.tab?.url ?? "");
                const { relaxedMatch } = await getSettings();
                const ok = relaxedMatch
                  ? domainMatches(tabHost, entry.host)
                  : hostMatches(tabHost, entry.host);
                if (!ok) {
                  sendResponse({ ok: false, error: "origin mismatch" });
                  return;
                }
              }
              try {
                const params = parseTotp(entry.totp);
                const code = await generateTotp(params);
                sendResponse({
                  ok: true,
                  code,
                  period: params.period,
                  secondsRemaining: secondsRemaining(params.period),
                });
              } catch (err) {
                sendResponse({
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
              return;
            }

            case "listFillItems": {
              // The content script asks for the user's cards/identities to show
              // in OUR picker when card/identity fields are detected. The
              // response is MASKED: only the item name, a last4/city subtitle and
              // the vault label - never the full number, cvv, or any identity
              // secret. Cards/identities have no host binding, so the full set is
              // returned and the user explicitly picks.
              if (!unlocked) {
                sendResponse({ ok: true, cards: [], identities: [] });
                return;
              }
              const { cards, identities } = await loadFillableEntries();
              sendResponse({
                ok: true,
                cards: cards.map((card) => ({
                  vaultId: card.vaultId,
                  itemId: card.itemId,
                  name: card.name,
                  vaultName: vaultMeta.get(card.vaultId)?.name ?? "",
                  last4: String(card.data.number ?? "")
                    .replace(/\D/g, "")
                    .slice(-4),
                })),
                identities: identities.map((identity) => ({
                  vaultId: identity.vaultId,
                  itemId: identity.itemId,
                  name: identity.name,
                  vaultName: vaultMeta.get(identity.vaultId)?.name ?? "",
                  city: String(identity.data.city ?? ""),
                })),
              });
              return;
            }

            case "fillItemField": {
              // Single-field fill on an explicit user click in our picker. Unlike
              // a login fill there is no host binding (cards/identities fill
              // wherever the user picked), but the full value (incl. number/cvv)
              // is only ever returned on this explicit request, never in
              // listFillItems. The content script asks once per field.
              if (!unlocked) {
                sendResponse({ ok: false, error: "vault is locked" });
                return;
              }
              const vaultId = String(message.vaultId ?? "");
              const itemId = String(message.itemId ?? "");
              const field = String(message.field ?? "");
              const { cards, identities } = await loadFillableEntries();
              const entry =
                cards.find((c) => c.vaultId === vaultId && c.itemId === itemId) ??
                identities.find((i) => i.vaultId === vaultId && i.itemId === itemId);
              if (!entry) {
                sendResponse({ ok: false, error: "not found" });
                return;
              }
              const raw = entry.data[field];
              sendResponse({
                ok: true,
                value: raw === undefined || raw === null ? "" : String(raw),
              });
              return;
            }

            case "saveDecision": {
              if (!unlocked) {
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

            case "listItems": {
              if (!unlocked) {
                sendResponse({ ok: false, error: "vault is locked" });
                return;
              }
              const vaultId = String(message.vaultId ?? "");
              try {
                const res = await apiFetch(
                  `/api/v1/vaults/${vaultId}/items`,
                  { method: "GET" },
                );
                if (!res.ok) {
                  sendResponse({ ok: false, error: `HTTP ${res.status}` });
                  return;
                }
                sendResponse({ ok: true, items: await res.json() });
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
              sendResponse({ ok: true, password: generateSecret(cfg) });
              return;
            }

            case "logGeneratedPassword": {
              const password = String(message.password ?? "");
              if (password) {
                const existing = genHistory.find((e) => e.password === password);
                if (existing) {
                  // Re-copying the same password refreshes its recency rather
                  // than adding a duplicate row.
                  existing.createdAt = Date.now();
                } else {
                  genHistory.push({
                    id: makeCaptureId(),
                    password,
                    createdAt: Date.now(),
                  });
                }
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

            // -----------------------------------------------------------
            // Multi-step login: remember the email/username across steps
            // -----------------------------------------------------------
            case "rememberUsername": {
              const host = String(message.host ?? "");
              const username = String(message.username ?? "");
              if (host && username) {
                pendingUsernames.set(host, { username, at: Date.now() });
                void persistPendingUsernames();
              }
              sendResponse({ ok: true });
              return;
            }

            case "getRememberedUsername": {
              const host = String(message.host ?? "");
              const entry = pendingUsernames.get(host);
              if (entry && Date.now() - entry.at <= PENDING_USERNAME_TTL_MS) {
                sendResponse({ ok: true, username: entry.username });
              } else {
                pendingUsernames.delete(host);
                sendResponse({ ok: true, username: "" });
              }
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
