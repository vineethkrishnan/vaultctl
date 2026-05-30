// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect, useCallback, type CSSProperties, type FormEvent } from "react";
import {
  Shield,
  Search,
  Copy,
  Lock,
  Save,
  KeyRound,
  ExternalLink,
  Check,
  Loader2,
} from "lucide-react";
import { deriveKeys, fromBase64, toBase64, unpad } from "@shared/crypto";

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
}

type Phase = "loading" | "connect" | "email" | "password" | "list";

const decoder = new TextDecoder();

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

  const loadItems = useCallback(
    async (url: string, accessToken: string, vaultId: string) => {
      const raw = await api<ItemResponse[]>(url, `/api/v1/vaults/${vaultId}/items`, {
        token: accessToken,
      });
      const decrypted: DecryptedItem[] = [];
      for (const item of raw) {
        if (item.trashed) continue;
        let name = "[encrypted]";
        let username = "";
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
            ) as { username?: string; uri?: string };
            username = data.username ?? "";
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
        if (session?.isUnlocked && session.accessToken && session.vaults?.length) {
          const first = session.vaults[0]!;
          setToken(session.accessToken);
          setVaults(session.vaults);
          setActiveVaultId(first.id);
          setPhase("list");
          try {
            await loadItems(url, session.accessToken, first.id);
          } catch {
            // token may have expired across an SW restart — fall back to login
            if (!cancelled) setPhase(url ? "email" : "connect");
          }
        } else {
          setPhase(url ? "email" : "connect");
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

      await bg({ type: "setToken", token: res.accessToken });
      await bg({
        type: "unlock",
        // number[] survives runtime.sendMessage JSON serialization (a raw
        // Uint8Array does not).
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
      setToken(res.accessToken);
      setVaults(meta);
      setPassword("");
      if (first) {
        setActiveVaultId(first.id);
        setPhase("list");
        await loadItems(serverUrl, res.accessToken, first.id);
      } else {
        setError("No vaults on this account yet — create one in the web vault.");
        setPhase("list");
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "INVALID_CREDENTIALS") setError("Invalid email or password");
      else if (code === "ACCOUNT_LOCKED") setError("Account locked — too many attempts");
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

  async function copyPassword(item: DecryptedItem) {
    try {
      const data = JSON.parse(
        decoder.decode(await decryptForVault(activeVaultId, item.encryptedData)),
      ) as { password?: string };
      if (data.password) copyText(data.password, "password");
    } catch {
      setError("Could not decrypt password");
    }
  }

  async function handleSaveCapture(captureId: string) {
    try {
      await bg({ type: "consumeCapturedLogin", id: captureId });
      setCaptures((existing) => existing.filter((c) => c.id !== captureId));
    } catch {
      // leave in place to retry
    }
  }

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
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15 text-brand">
          <Shield className="h-6 w-6" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">vaultctl</h1>

        {error && (
          <div className="w-full rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
            {error}
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
              onClick={() => setPhase("email")}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Use a different account
            </button>
          </form>
        )}
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
    <div className="animate-fade-in flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand/15 text-brand">
          <Shield className="h-[14px] w-[14px]" />
        </span>
        <span className="text-sm font-semibold tracking-tight flex-1 truncate">
          {vaults.find((v) => v.id === activeVaultId)?.name ?? "vaultctl"}
        </span>
        <button
          onClick={handleLock}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          title="Lock"
        >
          <Lock className="h-4 w-4" />
        </button>
      </div>

      {/* Captured logins */}
      {captures.length > 0 && (
        <div className="border-b border-border px-3 py-2 space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Captured logins
          </div>
          {captures.map((capture) => (
            <div
              key={capture.id}
              className="animate-fade-up flex items-center gap-2 rounded-lg border border-border bg-card/50 px-2.5 py-2"
            >
              <Save className="h-3.5 w-3.5 text-brand shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{safeHostname(capture.url)}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {capture.username || "(no username)"}
                </div>
              </div>
              <button
                onClick={() => handleSaveCapture(capture.id)}
                className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90"
              >
                Save
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2.5">
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
      <div className="flex-1 overflow-y-auto px-2 pb-2">
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

      {/* Status bar */}
      {copied && (
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-xs text-brand">
          <Check className="h-3.5 w-3.5" />
          Copied {copied} — clipboard clears in 30s
        </div>
      )}
    </div>
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
