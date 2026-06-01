// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect, useCallback, type CSSProperties, type FormEvent } from "react";
import {
  Search,
  Copy,
  Lock,
  Save,
  KeyRound,
  ExternalLink,
  Check,
  Loader2,
  Wallet,
  Wand2,
  Send as SendIcon,
  Settings as SettingsIcon,
  RefreshCw,
  Bell,
  Trash2,
  CheckCheck,
  X,
  BookOpen,
  Mail,
  Fingerprint,
} from "lucide-react";
import { deriveKeys, fromBase64, toBase64, unpad } from "@shared/crypto";
import {
  isBiometricAvailable,
  isBiometricEnrolled,
  getBiometricRecord,
  enrollBiometric,
  clearBiometric,
  unlockWithBiometric,
} from "./biometric";

// ── Minimal API shapes (mirror web/src/shared/types/api.ts) ────────────────
interface PreloginResponse {
  salt: string;
  iterations: number;
  memoryKB: number;
  parallelism: number;
}
interface VaultMembership {
  vaultId: string;
  vaultName: string;
  vaultType: "personal" | "shared";
  encryptedVaultKey: string;
}
interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  encryptedPrivateKey: string;
  encryptedIdentityPrivateKey: string;
  vaults: VaultMembership[];
}
interface ItemResponse {
  id: string;
  itemType: string;
  encryptedName: string;
  encryptedData: string;
  favorite: boolean;
  trashed: boolean;
}

interface DecryptedItem {
  id: string;
  itemType: string;
  favorite: boolean;
  name: string;
  username: string;
  password: string;
  uri: string;
  encryptedData: string;
}

interface VaultMeta {
  id: string;
  name: string;
  type: string;
}

interface CapturedLoginSummary {
  id: string;
  url: string;
  username: string;
  capturedAt: number;
  read: boolean;
}

type Phase = "loading" | "connect" | "email" | "password" | "list";
type TabId = "vault" | "generator" | "send" | "notifications" | "settings";

const decoder = new TextDecoder();

const DOCS_URL = "https://vaultctl.vinelabs.de";
const VINELABS_URL = "https://vinelabs.de";
const SUPPORT_EMAIL = "support@vinelabs.de";

function bg<T = unknown>(message: Record<string, unknown>): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

async function api<T>(
  serverUrl: string,
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${serverUrl.replace(/\/$/, "")}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const code = json?.error?.code as string | undefined;
    const msg = (json?.error?.message as string | undefined) ?? `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { code?: string };
    err.code = code;
    throw err;
  }
  return json as T;
}

// Decrypt a wire blob using the background's in-memory vault key.
async function decryptForVault(vaultId: string, blobB64: string): Promise<Uint8Array> {
  const res = await bg<{ ok?: boolean; plaintextB64?: string; error?: string }>({
    type: "decryptForVault",
    vaultId,
    blobB64,
  });
  if (!res?.ok || !res.plaintextB64) throw new Error(res?.error ?? "decrypt failed");
  return fromBase64(res.plaintextB64);
}

export function Popup() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [kdf, setKdf] = useState<PreloginResponse | null>(null);
  const [token, setToken] = useState("");
  const [vaults, setVaults] = useState<VaultMeta[]>([]);
  const [activeVaultId, setActiveVaultId] = useState("");
  const [items, setItems] = useState<DecryptedItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captures, setCaptures] = useState<CapturedLoginSummary[]>([]);
  const [tab, setTab] = useState<TabId>("vault");
  const [remember, setRemember] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);

  const loadItems = useCallback(
    async (vaultId: string) => {
      // Fetch through the background so an expired access token is refreshed
      // transparently instead of bouncing the user back to the login screen.
      const res = await bg<{
        ok?: boolean;
        items?: ItemResponse[];
        error?: string;
      }>({ type: "listItems", vaultId });
      if (!res?.ok || !res.items) {
        throw new Error(res?.error ?? "failed to load items");
      }
      const raw = res.items;
      const decrypted: DecryptedItem[] = [];
      for (const item of raw) {
        if (item.trashed) continue;
        let name = "[encrypted]";
        let username = "";
        let password = "";
        let uri = "";
        try {
          name = decoder.decode(unpad(await decryptForVault(vaultId, item.encryptedName)));
        } catch {
          name = "[name unavailable]";
        }
        if (item.itemType === "login") {
          try {
            const data = JSON.parse(
              decoder.decode(await decryptForVault(vaultId, item.encryptedData)),
            ) as { username?: string; password?: string; uri?: string };
            username = data.username ?? "";
            password = data.password ?? "";
            uri = data.uri ?? "";
          } catch {
            // leave blank if data can't be read
          }
        }
        decrypted.push({
          id: item.id,
          itemType: item.itemType,
          favorite: item.favorite,
          name,
          username,
          password,
          uri,
          encryptedData: item.encryptedData,
        });
      }
      decrypted.sort((a, b) => a.name.localeCompare(b.name));
      setItems(decrypted);
    },
    [],
  );

  // Boot: load server URL + resume session if the worker is still unlocked.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await bg<{ url?: string }>({ type: "getServerUrl" });
        const url = stored?.url ?? "";
        if (cancelled) return;
        setServerUrl(url);

        const [available, record] = await Promise.all([
          isBiometricAvailable(),
          getBiometricRecord(),
        ]);
        if (!cancelled) {
          setBiometricAvailable(available);
          setBiometricEnrolled(record !== null);
          if (record && !email) setEmail(record.email);
        }

        const session = await bg<{
          isUnlocked?: boolean;
          accessToken?: string | null;
          vaults?: VaultMeta[];
        }>({ type: "getSession" });

        const caps = await bg<{ captures?: CapturedLoginSummary[] }>({
          type: "getCapturedLogins",
        });
        if (!cancelled && caps?.captures) setCaptures(caps.captures);

        if (cancelled) return;
        const fallbackToLogin = async () => {
          if (cancelled) return;
          if (!url) {
            setPhase("connect");
            return;
          }
          const remembered = await browser.storage.local.get(
            "vaultctl_remember_email",
          );
          const savedEmail = remembered.vaultctl_remember_email as
            | string
            | undefined;
          if (!savedEmail) {
            if (!cancelled) setPhase("email");
            return;
          }
          setEmail(savedEmail);
          setRemember(true);
          try {
            const params = await api<PreloginResponse>(
              url,
              `/api/v1/auth/prelogin?email=${encodeURIComponent(savedEmail)}`,
            );
            if (!cancelled) {
              setKdf(params);
              setPhase("password");
            }
          } catch {
            if (!cancelled) setPhase("email");
          }
        };

        if (session?.isUnlocked && session.accessToken && session.vaults?.length) {
          const first = session.vaults[0]!;
          setToken(session.accessToken);
          setVaults(session.vaults);
          setActiveVaultId(first.id);
          setPhase("list");
          try {
            await loadItems(first.id);
          } catch {
            // Session truly gone (token refresh also failed) - fall back to
            // login, honoring the remembered email so only the master password
            // is needed.
            await fallbackToLogin();
          }
        } else {
          await fallbackToLogin();
        }
      } catch {
        if (!cancelled) setPhase("connect");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadItems]);

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    await bg({ type: "setServerUrl", url: serverUrl });
    setPhase("email");
  }

  // Shared tail for every unlock path (password or biometric): hand the keys to
  // the background, then drop the user into their vault.
  async function completeLogin(
    res: LoginResponse,
    stretchedKey: Uint8Array,
    accountEmail: string,
  ) {
    await bg({
      type: "setToken",
      token: res.accessToken,
      refreshToken: res.refreshToken,
    });
    await bg({
      type: "unlock",
      stretchedKey: Array.from(stretchedKey),
      encryptedPrivateKey: res.encryptedPrivateKey,
      encryptedIdentityPrivateKey: res.encryptedIdentityPrivateKey,
      vaults: res.vaults.map((v) => ({
        vaultId: v.vaultId,
        encryptedVaultKey: v.encryptedVaultKey,
        vaultType: v.vaultType,
        vaultName: v.vaultName,
      })),
    });

    const meta: VaultMeta[] = res.vaults.map((v) => ({
      id: v.vaultId,
      name: v.vaultName,
      type: v.vaultType,
    }));
    const first = meta[0];
    setEmail(accountEmail);
    setToken(res.accessToken);
    setVaults(meta);
    setPassword("");
    if (first) {
      setActiveVaultId(first.id);
      setPhase("list");
      await loadItems(first.id);
    } else {
      setError("No vaults on this account yet - create one in the web vault.");
      setPhase("list");
    }
  }

  async function handleBiometricUnlock() {
    setError(null);
    setBiometricBusy(true);
    try {
      const secret = await unlockWithBiometric();
      const res = await api<LoginResponse>(serverUrl, "/api/v1/auth/login", {
        method: "POST",
        body: {
          email: secret.email,
          authHash: secret.authHash,
          deviceName: `${navigator.userAgent.slice(0, 96)} (extension)`,
        },
      });
      await completeLogin(res, fromBase64(secret.stretchedKey), secret.email);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "INVALID_CREDENTIALS") {
        // The stored authHash no longer matches (e.g. the master password was
        // changed elsewhere). Drop the stale enrollment and fall back to the
        // password form.
        await clearBiometric();
        setBiometricEnrolled(false);
        setError("Master password changed - sign in once to re-enable Touch ID");
      } else if (code === "RATE_LIMITED") {
        setError("Too many attempts - wait a few minutes and try again");
      } else {
        setError(err instanceof Error ? err.message : "Touch ID unlock failed");
      }
    } finally {
      setBiometricBusy(false);
    }
  }

  async function handlePrelogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const params = await api<PreloginResponse>(
        serverUrl,
        `/api/v1/auth/prelogin?email=${encodeURIComponent(email)}`,
      );
      setKdf(params);
      if (remember) {
        await browser.storage.local.set({ vaultctl_remember_email: email });
      } else {
        await browser.storage.local.remove("vaultctl_remember_email");
      }
      setPhase("password");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (!kdf) return;
    setError(null);
    setLoading(true);
    try {
      const salt = fromBase64(kdf.salt);
      const { authHash, stretchedKey } = await deriveKeys(password, salt, {
        iterations: kdf.iterations,
        memoryKB: kdf.memoryKB,
        parallelism: kdf.parallelism,
      });

      const res = await api<LoginResponse>(serverUrl, "/api/v1/auth/login", {
        method: "POST",
        body: {
          email,
          authHash: toBase64(authHash),
          deviceName: `${navigator.userAgent.slice(0, 96)} (extension)`,
        },
      });

      // number[] survives runtime.sendMessage JSON serialization inside
      // completeLogin (a raw Uint8Array does not).
      await completeLogin(res, stretchedKey, email);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "INVALID_CREDENTIALS") setError("Invalid email or password");
      else if (code === "ACCOUNT_LOCKED") setError("Account locked - too many attempts");
      else setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleLock() {
    try {
      await bg({ type: "lock" });
    } catch {
      // ignore
    }
    setItems([]);
    setToken("");
    setPhase(serverUrl ? "email" : "connect");
  }

  function flashCopied(label: string) {
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
    // Best-effort clipboard clear after 30s.
    setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 30_000);
  }

  function copyText(text: string, label: string) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => flashCopied(label));
  }

  function copyPassword(item: DecryptedItem) {
    if (!item.password) {
      setError("Could not decrypt password");
      return;
    }
    copyText(item.password, "password");
  }

  async function handleSaveCapture(captureId: string) {
    const res = await bg<{ ok?: boolean; error?: string }>({
      type: "saveCapturedLogin",
      id: captureId,
    });
    if (!res?.ok) {
      setError(res?.error || "Could not save this login to the vault");
      return;
    }
    setCaptures((existing) => existing.filter((c) => c.id !== captureId));
    // Reflect the new/updated item in the vault list immediately.
    if (activeVaultId) {
      try {
        await loadItems(activeVaultId);
      } catch {
        // list will refresh on next open
      }
    }
  }

  async function handleDismissCapture(captureId: string) {
    try {
      await bg({ type: "dismissCapturedLogin", id: captureId });
      setCaptures((existing) => existing.filter((c) => c.id !== captureId));
    } catch {
      // leave in place to retry
    }
  }

  async function handleMarkCaptureRead(captureId: string) {
    setCaptures((existing) =>
      existing.map((c) => (c.id === captureId ? { ...c, read: true } : c)),
    );
    try {
      await bg({ type: "markCaptureRead", id: captureId });
    } catch {
      // best effort — the badge reconciles on next popup open
    }
  }

  async function handleMarkAllCapturesRead() {
    setCaptures((existing) => existing.map((c) => ({ ...c, read: true })));
    try {
      await bg({ type: "markAllCapturesRead" });
    } catch {
      // best effort
    }
  }

  async function handleClearCaptures() {
    setCaptures([]);
    try {
      await bg({ type: "clearCapturedLogins" });
    } catch {
      // best effort
    }
  }

  const unreadCaptures = captures.reduce((n, c) => (c.read ? n : n + 1), 0);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="flex h-[480px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Connect / login ────────────────────────────────────────────────────
  if (phase === "connect" || phase === "email" || phase === "password") {
    return (
      <div className="animate-fade-up flex flex-col items-center justify-center p-6 space-y-4">
        <h1 className="sr-only">VaultCTL</h1>
        <div className="flex flex-col items-center gap-0.5">
          <BrandMark className="text-7xl text-brand" />
          <BrandMark variant="wordmark" className="block text-xl" />
        </div>

        {error && (
          <div className="w-full rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
            {error}
          </div>
        )}

        {biometricEnrolled && serverUrl && phase !== "connect" && (
          <div className="w-full space-y-2">
            <button
              type="button"
              onClick={handleBiometricUnlock}
              disabled={biometricBusy}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand hover:bg-brand/15 disabled:opacity-50"
            >
              {biometricBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Fingerprint className="h-4 w-4" />
              )}
              Unlock with Touch ID
            </button>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or use your master password
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        {phase === "connect" && (
          <form onSubmit={handleConnect} className="w-full space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              Connect to your vault server to get started.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Server URL</label>
              <input
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://vault.example.com"
                className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
              />
            </div>
            <button
              type="submit"
              disabled={!serverUrl}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90 disabled:opacity-50 disabled:hover:translate-y-0"
            >
              Continue
            </button>
          </form>
        )}

        {phase === "email" && (
          <form onSubmit={handlePrelogin} className="w-full space-y-3">
            <p className="text-sm text-muted-foreground text-center">Sign in to your vault.</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              autoComplete="email"
              className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="accent-brand"
              />
              Remember me on this device
            </label>
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90 disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
            </button>
            <button
              type="button"
              onClick={() => setPhase("connect")}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Change server ({safeHostname(serverUrl)})
            </button>
          </form>
        )}

        {phase === "password" && (
          <form onSubmit={handleLogin} className="w-full space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              Master password for <strong className="text-foreground">{email}</strong>
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Master password"
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
            />
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90 disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deriving keys...
                </>
              ) : (
                "Unlock"
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setRemember(false);
                void browser.storage.local.remove("vaultctl_remember_email");
                setPhase("email");
              }}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Use a different account
            </button>
          </form>
        )}

        <div className="w-full space-y-2 pt-2">
          <div className="flex items-center justify-center gap-4 text-xs">
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Documentation
            </a>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <Mail className="h-3.5 w-3.5" />
              Support
            </a>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            Crafted by{" "}
            <a
              href={VINELABS_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand hover:underline"
            >
              Vinelabs
            </a>
          </p>
        </div>
      </div>
    );
  }

  // ── Vault list ──────────────────────────────────────────────────────────
  const filtered = items.filter(
    (item) =>
      !searchQuery ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.uri.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="animate-fade-in flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <BrandMark className="text-2xl text-brand" />
        <span className="flex-1 truncate text-sm font-semibold tracking-tight">
          {tab === "vault"
            ? vaults.find((v) => v.id === activeVaultId)?.name ?? "Vault"
            : TAB_TITLE[tab]}
        </span>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "vault" && (
          <div className="animate-fade-in">

      {/* Search (sticky so it stays visible while the list scrolls) */}
      <div className="sticky top-0 z-10 bg-background/95 px-3 py-2.5 backdrop-blur-sm">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-2.5 py-2 focus-within:border-brand/60 focus-within:ring-2 focus-within:ring-brand/20">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search vault..."
            autoFocus
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Item list */}
      <div className="px-2 pb-2">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {items.length === 0 ? "No items in this vault" : "No matches"}
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-accent/60"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white" style={avatarStyle(item.name)}>
                <KeyRound className="h-4 w-4" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.name}</div>
                {item.username && (
                  <div className="text-xs text-muted-foreground truncate">{item.username}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                {item.username && (
                  <button
                    onClick={() => copyText(item.username, "username")}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Copy username"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
                {item.itemType === "login" && (
                  <button
                    onClick={() => copyPassword(item)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Copy password"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                  </button>
                )}
                {item.uri && (
                  <button
                    onClick={() => window.open(item.uri, "_blank")}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Open site"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

          </div>
        )}

        {tab === "generator" && <GeneratorTab onCopied={flashCopied} />}
        {tab === "send" && <SendTab />}
        {tab === "notifications" && (
          <NotificationsTab
            captures={captures}
            onSave={handleSaveCapture}
            onDismiss={handleDismissCapture}
            onMarkRead={handleMarkCaptureRead}
            onMarkAllRead={handleMarkAllCapturesRead}
            onClearAll={handleClearCaptures}
          />
        )}
        {tab === "settings" && (
          <SettingsTab
            serverUrl={serverUrl}
            onLock={handleLock}
            accountEmail={email}
            biometricAvailable={biometricAvailable}
            biometricEnrolled={biometricEnrolled}
            onBiometricChange={(enrolled) => setBiometricEnrolled(enrolled)}
          />
        )}
      </div>

      {/* Status bar */}
      {copied && (
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-xs text-brand">
          <Check className="h-3.5 w-3.5" />
          Copied {copied} - clipboard clears in 30s
        </div>
      )}

      {/* Bottom navigation */}
      <nav className="grid shrink-0 grid-cols-5 border-t border-border bg-card/60">
        {NAV_TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative flex flex-col items-center gap-1 py-2 text-[10px] font-medium ${
              tab === id ? "text-brand" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="relative">
              <Icon className="h-[18px] w-[18px]" />
              {id === "notifications" && unreadCaptures > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-semibold leading-none text-primary-foreground">
                  {unreadCaptures > 9 ? "9+" : unreadCaptures}
                </span>
              )}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

const TAB_TITLE: Record<TabId, string> = {
  vault: "Vault",
  generator: "Generator",
  send: "Send",
  notifications: "Notifications",
  settings: "Settings",
};

const NAV_TABS: { id: TabId; label: string; Icon: typeof Wallet }[] = [
  { id: "vault", label: "Vault", Icon: Wallet },
  { id: "generator", label: "Generator", Icon: Wand2 },
  { id: "send", label: "Send", Icon: SendIcon },
  { id: "notifications", label: "Alerts", Icon: Bell },
  { id: "settings", label: "Settings", Icon: SettingsIcon },
];

// ── Generator tab ──────────────────────────────────────────────────────────
const GEN_LOWER = "abcdefghijkmnopqrstuvwxyz";
const GEN_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const GEN_DIGITS = "23456789";
const GEN_SYMBOLS = "!@#$%^&*()-_=+[]{}";

interface GenEntry {
  id: string;
  password: string;
  createdAt: number;
}

function genWith(cfg: ExtSettings): string {
  let charset = "";
  if (cfg.genLower) charset += GEN_LOWER;
  if (cfg.genUpper) charset += GEN_UPPER;
  if (cfg.genDigits) charset += GEN_DIGITS;
  if (cfg.genSymbols) charset += GEN_SYMBOLS;
  if (!charset) charset = GEN_LOWER + GEN_UPPER + GEN_DIGITS;
  const len = Math.min(128, Math.max(8, cfg.genLength || 20));
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (v) => charset[v % charset.length]).join("");
}

function relativeAge(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function GeneratorTab({ onCopied }: { onCopied: (label: string) => void }) {
  const [cfg, setCfg] = useState<ExtSettings | null>(null);
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<GenEntry[]>([]);

  const refreshHistory = useCallback(
    () =>
      bg<{ entries?: GenEntry[] }>({ type: "getGenHistory" }).then((r) =>
        setHistory(r?.entries ?? []),
      ),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    bg<{ settings?: ExtSettings }>({ type: "getSettings" }).then((r) => {
      if (!cancelled && r?.settings) setCfg(r.settings);
    });
    void refreshHistory();
    return () => {
      cancelled = true;
    };
  }, [refreshHistory]);

  useEffect(() => {
    if (cfg) setValue(genWith(cfg));
  }, [cfg]);

  function update(patch: Partial<ExtSettings>) {
    setCfg((prev) => {
      const next = { ...(prev as ExtSettings), ...patch };
      void bg({ type: "setSettings", settings: next });
      return next;
    });
  }

  function copyOnly(pw: string) {
    navigator.clipboard.writeText(pw).then(() => {
      onCopied("password");
      setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 30_000);
    });
  }

  function copyCurrent() {
    copyOnly(value);
    void bg({ type: "logGeneratedPassword", password: value }).then(refreshHistory);
  }

  if (!cfg) {
    return <div className="p-3 text-sm text-muted-foreground">Loading...</div>;
  }

  const toggle = (label: string, on: boolean, key: keyof ExtSettings) => (
    <button
      onClick={() => update({ [key]: !on } as Partial<ExtSettings>)}
      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
        on
          ? "border-brand/50 bg-brand/10 text-foreground"
          : "border-border text-muted-foreground"
      }`}
    >
      {label}
      <span
        className={`h-3.5 w-3.5 rounded-full border ${on ? "border-brand bg-brand" : "border-border"}`}
      />
    </button>
  );

  return (
    <div className="animate-fade-in space-y-4 p-3">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-3">
        <code className="flex-1 break-all font-mono text-sm">{value}</code>
        <button
          onClick={() => setValue(genWith(cfg))}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Regenerate"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <button
          onClick={copyCurrent}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Copy"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Length</span>
          <span className="font-mono">{cfg.genLength}</span>
        </div>
        <input
          type="range"
          min={8}
          max={64}
          value={cfg.genLength}
          onChange={(e) => update({ genLength: Number(e.target.value) })}
          className="w-full accent-brand"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {toggle("a-z", cfg.genLower, "genLower")}
        {toggle("A-Z", cfg.genUpper, "genUpper")}
        {toggle("0-9", cfg.genDigits, "genDigits")}
        {toggle("!@#", cfg.genSymbols, "genSymbols")}
      </div>

      <button
        onClick={copyCurrent}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90"
      >
        Copy password
      </button>

      {/* Recent generated passwords (kept in memory, cleared on lock) */}
      <div className="space-y-2 rounded-lg border border-border bg-card/50 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent ({history.length})
          </span>
          {history.length > 0 && (
            <button
              onClick={() =>
                void bg({ type: "clearGenHistory" }).then(refreshHistory)
              }
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Generated passwords you copy or fill appear here.
          </p>
        ) : (
          <ul className="space-y-1">
            {[...history].reverse().map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <code className="flex-1 truncate font-mono text-xs">
                  {h.password}
                </code>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {relativeAge(h.createdAt)}
                </span>
                <button
                  onClick={() => copyOnly(h.password)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  title="Copy"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2 pt-1 text-xs">
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Keep
            <input
              type="number"
              min={1}
              max={50}
              value={cfg.historyMax}
              onChange={(e) => update({ historyMax: Number(e.target.value) })}
              className="w-12 rounded-md border border-border bg-card px-1.5 py-0.5 text-center"
            />
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Expire
            <select
              value={cfg.historyTtlMin}
              onChange={(e) => update({ historyTtlMin: Number(e.target.value) })}
              className="rounded-md border border-border bg-card px-1.5 py-0.5"
            >
              <option value={15}>15m</option>
              <option value={60}>1h</option>
              <option value={240}>4h</option>
              <option value={1440}>24h</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

// ── Send tab (not yet supported server-side) ────────────────────────────────
function SendTab() {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <SendIcon className="h-6 w-6" />
      </span>
      <p className="text-sm font-medium">Send isn&apos;t available yet</p>
      <p className="text-xs text-muted-foreground">
        Ephemeral encrypted sharing needs server support that vaultctl doesn&apos;t have yet.
        It&apos;ll show up here once the backend lands.
      </p>
    </div>
  );
}

// ── Notifications tab ────────────────────────────────────────────────────
function NotificationsTab({
  captures,
  onSave,
  onDismiss,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
}: {
  captures: CapturedLoginSummary[];
  onSave: (id: string) => void;
  onDismiss: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
}) {
  const unread = captures.reduce((n, c) => (c.read ? n : n + 1), 0);

  if (captures.length === 0) {
    return (
      <div className="animate-fade-in flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Bell className="h-6 w-6" />
        </span>
        <p className="text-sm font-medium">No notifications</p>
        <p className="text-xs text-muted-foreground">
          When the extension catches a login you haven&apos;t saved yet, it
          shows up here. Nothing to review right now.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {unread > 0 ? `${unread} unread` : "All caught up"}
        </span>
        <div className="flex items-center gap-3 text-xs">
          {unread > 0 && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
          <button
            onClick={onClearAll}
            className="flex items-center gap-1 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear all
          </button>
        </div>
      </div>

      <ul className="space-y-1.5">
        {[...captures].reverse().map((capture) => (
          <li
            key={capture.id}
            onClick={() => !capture.read && onMarkRead(capture.id)}
            className={`animate-fade-up flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
              capture.read
                ? "border-border bg-card/40"
                : "cursor-pointer border-brand/40 bg-brand/5"
            }`}
          >
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Save className="h-3.5 w-3.5" />
              {!capture.read && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">
                Save login for {safeHostname(capture.url)}?
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {capture.username || "(no username)"} ({relativeAge(capture.capturedAt)})
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSave(capture.id);
                }}
                className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90"
              >
                Save
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(capture.id);
                }}
                title="Dismiss"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Settings tab ─────────────────────────────────────────────────────────
interface ExtSettings {
  autofill: boolean;
  fieldIcon: boolean;
  savePrompt: boolean;
  toastMs: number;
  suggestPassword: boolean;
  genLength: number;
  genLower: boolean;
  genUpper: boolean;
  genDigits: boolean;
  genSymbols: boolean;
  historyMax: number;
  historyTtlMin: number;
  autoLockMin: number;
}

function BiometricSetting({
  serverUrl,
  accountEmail,
  available,
  enrolled,
  onChange,
}: {
  serverUrl: string;
  accountEmail: string;
  available: boolean;
  enrolled: boolean;
  onChange: (enrolled: boolean) => void;
}) {
  const [enrolling, setEnrolling] = useState(false);
  const [enrollEmail, setEnrollEmail] = useState(accountEmail);
  const [enrollPassword, setEnrollPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (accountEmail) setEnrollEmail(accountEmail);
  }, [accountEmail]);

  async function beginEnroll() {
    setLocalError(null);
    if (!enrollEmail || !enrollPassword) {
      setLocalError("Enter your email and master password");
      return;
    }
    setBusy(true);
    try {
      const params = await api<PreloginResponse>(
        serverUrl,
        `/api/v1/auth/prelogin?email=${encodeURIComponent(enrollEmail)}`,
      );
      const { authHash, stretchedKey } = await deriveKeys(
        enrollPassword,
        fromBase64(params.salt),
        {
          iterations: params.iterations,
          memoryKB: params.memoryKB,
          parallelism: params.parallelism,
        },
      );
      // Confirm the password is correct before storing it behind biometrics, so
      // we never enroll an authHash that can't actually log in.
      await api<LoginResponse>(serverUrl, "/api/v1/auth/login", {
        method: "POST",
        body: {
          email: enrollEmail,
          authHash: toBase64(authHash),
          deviceName: `${navigator.userAgent.slice(0, 96)} (extension)`,
        },
      });
      await enrollBiometric(serverUrl, {
        email: enrollEmail,
        authHash: toBase64(authHash),
        stretchedKey: toBase64(stretchedKey),
      });
      setEnrollPassword("");
      setEnrolling(false);
      onChange(true);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "INVALID_CREDENTIALS") setLocalError("Invalid email or password");
      else if (code === "RATE_LIMITED") setLocalError("Too many attempts - try again later");
      else setLocalError(err instanceof Error ? err.message : "Could not enable Touch ID");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    await clearBiometric();
    onChange(false);
  }

  if (!available) return null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card/50 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Security
      </div>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm">
            <Fingerprint className="h-3.5 w-3.5 text-brand" />
            Unlock with Touch ID
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {enrolled
              ? "Stored behind your device biometric on this browser."
              : "Skip the master password on this device after one sign-in."}
          </span>
        </span>
        {enrolled ? (
          <button
            type="button"
            onClick={disable}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/60"
          >
            Disable
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEnrolling((v) => !v)}
            className="shrink-0 rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-xs text-brand hover:bg-brand/15"
          >
            {enrolling ? "Cancel" : "Enable"}
          </button>
        )}
      </div>

      {enrolling && !enrolled && (
        <div className="space-y-2 pt-1">
          {localError && (
            <div className="rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">
              {localError}
            </div>
          )}
          <input
            type="email"
            value={enrollEmail}
            onChange={(e) => setEnrollEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-brand/60"
          />
          <input
            type="password"
            value={enrollPassword}
            onChange={(e) => setEnrollPassword(e.target.value)}
            placeholder="Master password"
            autoComplete="current-password"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-brand/60"
          />
          <button
            type="button"
            onClick={beginEnroll}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm and register Touch ID"}
          </button>
        </div>
      )}
    </div>
  );
}

function SettingsTab({
  serverUrl,
  onLock,
  accountEmail,
  biometricAvailable,
  biometricEnrolled,
  onBiometricChange,
}: {
  serverUrl: string;
  onLock: () => void;
  accountEmail: string;
  biometricAvailable: boolean;
  biometricEnrolled: boolean;
  onBiometricChange: (enrolled: boolean) => void;
}) {
  const [settings, setSettings] = useState<ExtSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    bg<{ settings?: ExtSettings }>({ type: "getSettings" }).then((res) => {
      if (!cancelled && res?.settings) setSettings(res.settings);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(patch: Partial<ExtSettings>) {
    setSettings((prev) => {
      const next = { ...(prev as ExtSettings), ...patch };
      void bg({ type: "setSettings", settings: next });
      return next;
    });
  }

  return (
    <div className="animate-fade-in space-y-3 p-3">
      <div className="rounded-lg border border-border bg-card/50 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Server</div>
        <div className="mt-1 truncate text-sm">{safeHostname(serverUrl) || "not set"}</div>
      </div>

      {settings && (
        <div className="space-y-2 rounded-lg border border-border bg-card/50 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Autofill &amp; saving
          </div>
          <Toggle
            label="Show field icon"
            hint="Inline icon inside login fields to fill"
            checked={settings.fieldIcon}
            onChange={(v) => update({ fieldIcon: v })}
          />
          <Toggle
            label="Autofill on page load"
            hint="Fill matching logins automatically, no click"
            checked={settings.autofill}
            onChange={(v) => update({ autofill: v })}
          />
          <Toggle
            label="Offer to save / update"
            hint="Prompt after a login submit"
            checked={settings.savePrompt}
            onChange={(v) => update({ savePrompt: v })}
          />
          <Toggle
            label="Suggest strong passwords"
            hint="Offer a generated password on signup fields"
            checked={settings.suggestPassword}
            onChange={(v) => update({ suggestPassword: v })}
          />
          <label className="flex items-center justify-between gap-3 pt-1">
            <span className="min-w-0">
              <span className="block text-sm">Prompt timeout</span>
              <span className="block text-[11px] text-muted-foreground">
                How long the save/update prompt stays before it fades
              </span>
            </span>
            <select
              value={settings.toastMs}
              onChange={(e) => update({ toastMs: Number(e.target.value) })}
              className="shrink-0 rounded-md border border-border bg-card px-2 py-1 text-xs"
            >
              <option value={4000}>4s</option>
              <option value={8000}>8s</option>
              <option value={15000}>15s</option>
              <option value={30000}>30s</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 pt-1">
            <span className="min-w-0">
              <span className="block text-sm">Auto-lock</span>
              <span className="block text-[11px] text-muted-foreground">
                Lock after this much inactivity. Closing the browser always locks.
              </span>
            </span>
            <select
              value={settings.autoLockMin}
              onChange={(e) => update({ autoLockMin: Number(e.target.value) })}
              className="shrink-0 rounded-md border border-border bg-card px-2 py-1 text-xs"
            >
              <option value={1}>1 min</option>
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>1 hour</option>
              <option value={0}>Until I close the browser</option>
            </select>
          </label>
        </div>
      )}

      <BiometricSetting
        serverUrl={serverUrl}
        accountEmail={accountEmail}
        available={biometricAvailable}
        enrolled={biometricEnrolled}
        onChange={onBiometricChange}
      />

      <button
        onClick={() => serverUrl && window.open(serverUrl, "_blank")}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-accent/60"
      >
        <ExternalLink className="h-4 w-4 text-muted-foreground" />
        Open web vault
      </button>
      <button
        onClick={onLock}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-accent/60"
      >
        <Lock className="h-4 w-4 text-muted-foreground" />
        Lock vault
      </button>
      <AboutCard />
    </div>
  );
}

function AboutCard() {
  const version = browser.runtime.getManifest().version;
  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-card/50 p-3">
      <div className="flex flex-col items-center gap-0.5">
        <BrandMark className="text-5xl text-brand" />
        <BrandMark variant="wordmark" className="block text-lg" />
      </div>
      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        Zero-knowledge password vault. Encryption keys never leave this device.
      </p>

      <dl className="space-y-1 border-t border-border pt-2 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono">{version}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Maintained by</dt>
          <dd>Vineeth N K</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Crafted from</dt>
          <dd>
            <a
              href={VINELABS_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-brand"
            >
              VineLabs
            </a>
          </dd>
        </div>
      </dl>

      <div className="flex items-center justify-center gap-4 border-t border-border pt-2 text-[11px]">
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-brand"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Documentation
        </a>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-brand"
        >
          <Mail className="h-3.5 w-3.5" />
          Support
        </a>
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && (
          <span className="block text-[11px] text-muted-foreground">{hint}</span>
        )}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-brand" : "bg-border"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function avatarStyle(name: string): CSSProperties {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 52% 46%), hsl(${(hue + 45) % 360} 58% 38%))`,
  };
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const BRAND_GLYPHS = { emblem: 0xe000, wordmark: 0xe001 } as const;

function BrandMark({
  variant = "emblem",
  className = "",
}: {
  variant?: keyof typeof BRAND_GLYPHS;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label="VaultCTL"
      className={`font-brand leading-none ${className}`}
    >
      {String.fromCharCode(BRAND_GLYPHS[variant])}
    </span>
  );
}
