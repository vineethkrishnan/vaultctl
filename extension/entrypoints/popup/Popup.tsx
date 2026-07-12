// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect, useCallback, type CSSProperties, type FormEvent } from "react";
import { useTranslation, Trans } from "react-i18next";
import type { TFunction } from "i18next";
import { changeLanguage, currentLanguage, LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type Language } from "./i18n";
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
  Heart,
  ArrowUpCircle,
  Users,
  ChevronDown,
  CreditCard,
  User,
  Ban,
  Download,
  ShieldAlert,
  ChevronRight,
  ArrowLeft,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  isWeakPassword,
  reusedPasswords,
  breachCount,
} from "../../utils/password-health";
import { deriveKeys, fromBase64, toBase64, unpad } from "@shared/crypto";
import {
  parseTotp,
  generateTotp,
  secondsRemaining,
  type TotpParams,
} from "@shared/totp";
import {
  generateSecret,
  GEN_MAX_LENGTH,
  GEN_WORDS_MIN,
  GEN_WORDS_MAX,
  type GenMode,
} from "../../utils/password-gen";
import { isSafeHttpUri } from "../../utils/host";
import { copySecret } from "../../utils/clipboard";
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
  totp: string;
  // For credit_card / identity rows: a masked subtitle (card last4 / city). The
  // full number and cvv are never decrypted into the list.
  subtitle: string;
  encryptedData: string;
}

interface VaultMeta {
  id: string;
  name: string;
  type: string;
}

interface CapturedLoginSummary {
  id: string;
  kind?: "login" | "credit_card" | "identity";
  url: string;
  username: string;
  // Masked title for card/identity captures (card brand + last4 / full name).
  title?: string;
  capturedAt: number;
  read: boolean;
}

type Phase = "loading" | "connect" | "email" | "password" | "list";
type TabId = "vault" | "generator" | "send" | "notifications" | "settings";

// Which update severities raise the Alerts-tab notice. Default "all" means an
// available update is shown when the user hasn't set a preference. Mirrors the
// web client's NotifyLevel.
type UpdateNotifyLevel = "all" | "minor" | "major" | "off";

function severityPassesLevel(
  severity: string | undefined,
  level: UpdateNotifyLevel,
): boolean {
  if (level === "off") return false;
  if (level === "all") return true;
  if (level === "major") return severity === "major";
  return severity === "minor" || severity === "major";
}

const decoder = new TextDecoder();

const DOCS_URL = "https://vaultctl.vinelab.in";
const VINELABS_URL = "https://vinelab.in";
const SUPPORT_EMAIL = "support@vinelab.in";

function bg<T = unknown>(message: Record<string, unknown>): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

function apiError(message: string, code: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

async function api<T>(
  serverUrl: string,
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const base = serverUrl.replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        // Only set Content-Type when there is a body. On a bodyless GET it is
        // a non-safelisted header that forces a CORS preflight, which the
        // health check does not need and some setups (Firefox without the
        // host grant) reject.
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    // fetch rejects with a bare TypeError ("Failed to fetch" / "Load failed" /
    // "NetworkError ...") for DNS, connection-refused, TLS and CORS failures -
    // none of which are legible to a user. Map them all to one clear message.
    throw apiError(
      `Can't reach the server at ${base}. Check the address is correct and that the server is running.`,
      "NETWORK_ERROR",
    );
  }

  const text = await res.text();
  let json: { error?: { code?: string; message?: string } } = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw apiError(
        `${base} returned an unexpected response. Make sure the URL points to a vaultctl server.`,
        "BAD_RESPONSE",
      );
    }
  }
  if (!res.ok) {
    const code = json?.error?.code;
    const msg = json?.error?.message ?? `Server error (HTTP ${res.status}).`;
    throw apiError(msg, code ?? `HTTP_${res.status}`);
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
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("loading");
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [kdf, setKdf] = useState<PreloginResponse | null>(null);
  const [token, setToken] = useState("");
  const [vaults, setVaults] = useState<VaultMeta[]>([]);
  const [activeVaultId, setActiveVaultId] = useState("");
  const [items, setItems] = useState<DecryptedItem[]>([]);
  const [detailItem, setDetailItem] = useState<DecryptedItem | null>(null);
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(null);
  const [detailError, setDetailError] = useState(false);
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
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateNotify, setUpdateNotify] = useState<UpdateNotifyLevel>("all");
  const [breachCheck, setBreachCheck] = useState(false);

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
        let totp = "";
        let subtitle = "";
        try {
          name = decoder.decode(unpad(await decryptForVault(vaultId, item.encryptedName)));
        } catch {
          name = "[name unavailable]";
        }
        if (item.itemType === "login") {
          try {
            const data = JSON.parse(
              decoder.decode(await decryptForVault(vaultId, item.encryptedData)),
            ) as { username?: string; password?: string; uri?: string; totp?: string };
            username = data.username ?? "";
            password = data.password ?? "";
            uri = data.uri ?? "";
            totp = data.totp ?? "";
          } catch {
            // leave blank if data can't be read
          }
        } else if (item.itemType === "credit_card" || item.itemType === "identity") {
          try {
            const data = JSON.parse(
              decoder.decode(await decryptForVault(vaultId, item.encryptedData)),
            ) as { number?: string; city?: string; state?: string };
            // Masked subtitle only: card -> last4, identity -> city/state. The
            // full number and cvv stay encrypted and never enter the list.
            if (item.itemType === "credit_card") {
              const last4 = String(data.number ?? "").replace(/\D/g, "").slice(-4);
              subtitle = last4 ? `•••• ${last4}` : "";
            } else {
              subtitle = [data.city, data.state].filter(Boolean).join(", ");
            }
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
          totp,
          subtitle,
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
          activeVaultId?: string;
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
          const active =
            session.vaults.find((v) => v.id === session.activeVaultId) ??
            session.vaults[0]!;
          setToken(session.accessToken);
          setVaults(session.vaults);
          setActiveVaultId(active.id);
          setPhase("list");
          try {
            await loadItems(active.id);
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

  // Check for an available update once unlocked so the Alerts tab can surface it
  // (in addition to the Settings update card), gated by the user's preference.
  useEffect(() => {
    if (phase !== "list") return;
    let cancelled = false;
    (async () => {
      const stored = await bg<{ settings?: ExtSettings }>({ type: "getSettings" });
      if (!cancelled && stored?.settings) {
        setUpdateNotify(stored.settings.updateNotify ?? "all");
        setBreachCheck(stored.settings.breachCheck ?? false);
      }
      const res = await bg<UpdateInfo>({ type: "checkUpdate" });
      if (!cancelled && res?.ok) setUpdateInfo(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  async function handleConnect(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const raw = serverUrl.trim();
    if (!/^https?:\/\//i.test(raw)) {
      setError(t("connect.errors.invalidUrl"));
      return;
    }
    // Reduce whatever the user pasted to its origin. A URL copied from the
    // address bar carries a path (e.g. https://host/login), and appending
    // /api/v1/health to that hits the SPA fallback, which returns index.html
    // and surfaces as a confusing "unexpected response" error.
    let base: string;
    try {
      base = new URL(raw).origin;
    } catch {
      setError(t("connect.errors.invalidUrl"));
      return;
    }
    setLoading(true);
    try {
      const health = await api<{ status?: string }>(base, "/api/v1/health");
      if (typeof health?.status !== "string") {
        setError(t("connect.errors.notVaultctl", { server: base }));
        return;
      }
      if (health.status !== "ok") {
        setError(t("connect.errors.serverUnhealthy"));
      }
      await bg({ type: "setServerUrl", url: base });
      setServerUrl(base);
      setPhase("email");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("connect.errors.unreachable"));
    } finally {
      setLoading(false);
    }
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
      setError(t("vault.noVaults"));
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
        setError(t("biometric.errors.masterPasswordChanged"));
      } else if (code === "RATE_LIMITED") {
        setError(t("biometric.errors.rateLimited"));
      } else {
        setError(err instanceof Error ? err.message : t("biometric.errors.unlockFailed"));
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
      setError(err instanceof Error ? err.message : t("email.connectionFailed"));
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
      if (code === "INVALID_CREDENTIALS") setError(t("password.errors.invalidCredentials"));
      else if (code === "ACCOUNT_LOCKED") setError(t("password.errors.accountLocked"));
      else setError(err instanceof Error ? err.message : t("password.errors.loginFailed"));
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
    closeDetail();
    setToken("");
    setPhase(serverUrl ? "email" : "connect");
  }

  function flashCopied(label: string) {
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
  }

  function copyText(text: string, label: string) {
    if (!text) return;
    void copySecret(text).then((ok) => {
      if (ok) flashCopied(label);
    });
  }

  function copyPassword(item: DecryptedItem) {
    if (!item.password) {
      setError(t("vault.errors.decryptPassword"));
      return;
    }
    copyText(item.password, t("common:password"));
  }

  async function openDetail(item: DecryptedItem) {
    setDetailItem(item);
    setDetailData(null);
    setDetailError(false);
    try {
      const parsed = JSON.parse(
        decoder.decode(await decryptForVault(activeVaultId, item.encryptedData)),
      ) as Record<string, unknown>;
      setDetailData(parsed);
    } catch {
      setDetailError(true);
    }
  }

  function closeDetail() {
    setDetailItem(null);
    setDetailData(null);
    setDetailError(false);
  }

  async function handleSwitchVault(vaultId: string) {
    if (!vaultId || vaultId === activeVaultId) return;
    setActiveVaultId(vaultId);
    setSearchQuery("");
    closeDetail();
    void bg({ type: "setActiveVault", vaultId });
    try {
      await loadItems(vaultId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("vault.errors.switchFailed"));
    }
  }

  async function handleSaveCapture(captureId: string, vaultId?: string) {
    const res = await bg<{ ok?: boolean; error?: string }>({
      type: "saveCapturedLogin",
      id: captureId,
      ...(vaultId ? { vaultId } : {}),
    });
    if (!res?.ok) {
      setError(res?.error || t("notifications.saveError"));
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
      // best effort - the badge reconciles on next popup open
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
  const updatePending =
    !!updateInfo &&
    updateInfo.enabled &&
    updateInfo.updateAvailable &&
    severityPassesLevel(updateInfo.severity, updateNotify);
  const alertCount = unreadCaptures + (updatePending ? 1 : 0);

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
              {t("biometric.unlockButton")}
            </button>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t("biometric.orMasterPassword")}
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        {phase === "connect" && (
          <form onSubmit={handleConnect} className="w-full space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              {t("connect.intro")}
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("connect.serverUrlLabel")}</label>
              <input
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder={t("connect.serverUrlPlaceholder")}
                className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
              />
            </div>
            <button
              type="submit"
              disabled={!serverUrl || loading}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90 disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? t("connect.checking") : t("common:continue")}
            </button>
          </form>
        )}

        {phase === "email" && (
          <form onSubmit={handlePrelogin} className="w-full space-y-3">
            <p className="text-sm text-muted-foreground text-center">{t("email.intro")}</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("email.placeholder")}
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
              {t("email.rememberMe")}
            </label>
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90 disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common:continue")}
            </button>
            <button
              type="button"
              onClick={() => setPhase("connect")}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              {t("email.changeServer", { host: safeHostname(serverUrl) })}
            </button>
          </form>
        )}

        {phase === "password" && (
          <form onSubmit={handleLogin} className="w-full space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              <Trans
                i18nKey="password.intro"
                values={{ email }}
                components={{ strong: <strong className="text-foreground" /> }}
              />
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("password.placeholder")}
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
                  {t("password.deriving")}
                </>
              ) : (
                t("password.unlock")
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
              {t("password.useDifferentAccount")}
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
              {t("common:documentation")}
            </a>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <Mail className="h-3.5 w-3.5" />
              {t("common:support")}
            </a>
          </div>
          <p className="flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
            {t("footer.craftedBy")}
            <a
              href={VINELABS_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand hover:underline"
            >
              Vinelabs
            </a>
            with
            <Heart className="h-3 w-3 fill-red-500 text-red-500" />
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
      item.subtitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.uri.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="animate-fade-in flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <BrandMark className="text-2xl text-brand" />
        {tab === "vault" && vaults.length > 1 ? (
          <VaultSwitcher
            vaults={vaults}
            activeVaultId={activeVaultId}
            onSwitch={handleSwitchVault}
          />
        ) : (
          <span className="flex-1 truncate text-sm font-semibold tracking-tight">
            {tab === "vault"
              ? vaults.find((v) => v.id === activeVaultId)?.name ?? t("vault.fallbackName")
              : t(`tabTitles.${tab}`)}
          </span>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "vault" && (
          <div className="animate-fade-in">
      {detailItem ? (
        <ItemDetail
          item={detailItem}
          data={detailData}
          error={detailError}
          onBack={closeDetail}
          onCopy={copyText}
          t={t}
        />
      ) : (
        <>

      <PasswordCheckup items={items} breachCheck={breachCheck} serverUrl={serverUrl} />

      {/* Search (sticky so it stays visible while the list scrolls) */}
      <div className="sticky top-0 z-10 bg-background/95 px-3 py-2.5 backdrop-blur-sm">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-2.5 py-2 focus-within:border-brand/60 focus-within:ring-2 focus-within:ring-brand/20">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("vault.searchPlaceholder")}
            autoFocus
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Item list */}
      <div className="px-2 pb-2">
        {filtered.length === 0 ? (
          items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Wallet className="h-6 w-6" />
              </span>
              <p className="text-sm font-medium">{t("vault.onboardingTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("vault.onboardingBody")}</p>
              <button
                onClick={() => openImport(serverUrl)}
                className="mt-1 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90"
              >
                <Download className="h-4 w-4" />
                {t("vault.importPasswords")}
              </button>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t("vault.noMatches")}
            </div>
          )
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              onClick={() => openDetail(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openDetail(item);
                }
              }}
              className="group flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-accent/60"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white" style={avatarStyle(item.name)}>
                <ItemTypeIcon itemType={item.itemType} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.name}</div>
                {(item.username || item.subtitle) && (
                  <div className="text-xs text-muted-foreground truncate">
                    {item.username || item.subtitle}
                  </div>
                )}
                {item.totp && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <TotpChip secret={item.totp} onCopied={() => flashCopied(t("vault.totpCode"))} />
                  </div>
                )}
              </div>
              <div
                onClick={(e) => e.stopPropagation()}
                className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100"
              >
                {item.username && (
                  <button
                    onClick={() => copyText(item.username, t("common:username"))}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title={t("vault.copyUsername")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
                {item.itemType === "login" && (
                  <button
                    onClick={() => copyPassword(item)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title={t("vault.copyPassword")}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                  </button>
                )}
                {item.uri && isSafeHttpUri(item.uri) && (
                  <button
                    onClick={() =>
                      window.open(item.uri, "_blank", "noopener,noreferrer")
                    }
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title={t("vault.openSite")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
        </>
      )}
          </div>
        )}

        {tab === "generator" && <GeneratorTab onCopied={flashCopied} />}
        {tab === "send" && <SendTab />}
        {tab === "notifications" && (
          <NotificationsTab
            captures={captures}
            vaults={vaults}
            activeVaultId={activeVaultId}
            update={updatePending ? updateInfo : null}
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
          {t("status.copied", { label: copied })}
        </div>
      )}

      {/* Bottom navigation */}
      <nav className="grid shrink-0 grid-cols-5 border-t border-border bg-card/60">
        {NAV_TABS.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative flex flex-col items-center gap-1 py-2 text-[10px] font-medium ${
              tab === id ? "text-brand" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="relative">
              <Icon className="h-[18px] w-[18px]" />
              {id === "notifications" && alertCount > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-1 text-[9px] font-semibold leading-none text-primary-foreground">
                  {alertCount > 9 ? "9+" : alertCount}
                </span>
              )}
            </span>
            {t(labelKey)}
          </button>
        ))}
      </nav>
    </div>
  );
}

// Vault switcher: a native select wrapped so the active vault name (and a
// shared badge) read like the header title it replaces. Switching persists the
// choice in the background and reloads that vault's items.
function VaultSwitcher({
  vaults,
  activeVaultId,
  onSwitch,
}: {
  vaults: VaultMeta[];
  activeVaultId: string;
  onSwitch: (vaultId: string) => void;
}) {
  const { t } = useTranslation();
  const active = vaults.find((v) => v.id === activeVaultId);
  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-1">
      {active?.type === "shared" && (
        <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate text-sm font-semibold tracking-tight">
        {active?.name ?? t("vault.fallbackName")}
      </span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <select
        aria-label={t("vault.switchVault")}
        value={activeVaultId}
        onChange={(e) => onSwitch(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {vaults.map((v) => (
          <option key={v.id} value={v.id}>
            {v.type === "shared" ? t("vault.sharedOption", { name: v.name }) : v.name}
          </option>
        ))}
      </select>
    </div>
  );
}

const NAV_TABS: { id: TabId; labelKey: string; Icon: typeof Wallet }[] = [
  { id: "vault", labelKey: "tabs.vault", Icon: Wallet },
  { id: "generator", labelKey: "tabs.generator", Icon: Wand2 },
  { id: "send", labelKey: "tabs.send", Icon: SendIcon },
  { id: "notifications", labelKey: "tabs.alerts", Icon: Bell },
  { id: "settings", labelKey: "tabs.settings", Icon: SettingsIcon },
];

// ── Generator tab ──────────────────────────────────────────────────────────
interface GenEntry {
  id: string;
  password: string;
  createdAt: number;
}

function genWith(cfg: ExtSettings): string {
  return generateSecret(cfg);
}

function relativeAge(ts: number, t: TFunction): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return t("generator.justNow");
  if (mins < 60) return t("generator.minutesAgo", { count: mins });
  return t("generator.hoursAgo", { count: Math.round(mins / 60) });
}

function GeneratorTab({ onCopied }: { onCopied: (label: string) => void }) {
  const { t } = useTranslation();
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
    void copySecret(pw).then((ok) => {
      if (ok) onCopied(t("common:password"));
    });
  }

  function copyCurrent() {
    copyOnly(value);
    void bg({ type: "logGeneratedPassword", password: value }).then(refreshHistory);
  }

  if (!cfg) {
    return <div className="p-3 text-sm text-muted-foreground">{t("common:loading")}</div>;
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
          title={t("generator.regenerate")}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <button
          onClick={copyCurrent}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("common:copy")}
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
        {(["password", "passphrase"] as GenMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => update({ genMode: mode })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              (cfg.genMode ?? "password") === mode
                ? "bg-brand/15 text-brand"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`generator.mode.${mode}`)}
          </button>
        ))}
      </div>

      {(cfg.genMode ?? "password") === "passphrase" ? (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("generator.words")}</span>
              <span className="font-mono">{cfg.genWords}</span>
            </div>
            <input
              type="range"
              min={GEN_WORDS_MIN}
              max={GEN_WORDS_MAX}
              value={cfg.genWords}
              onChange={(e) => update({ genWords: Number(e.target.value) })}
              className="w-full accent-brand"
            />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{t("generator.separator")}</span>
            <input
              type="text"
              maxLength={3}
              value={cfg.genWordSep}
              onChange={(e) => update({ genWordSep: e.target.value })}
              className="w-16 rounded-md border border-border bg-card px-2 py-1 text-center font-mono text-xs"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            {toggle(t("generator.capitalize"), cfg.genWordCaps, "genWordCaps")}
            {toggle(t("generator.includeNumber"), cfg.genWordDigit, "genWordDigit")}
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("generator.length")}</span>
              <span className="font-mono">{cfg.genLength}</span>
            </div>
            <input
              type="range"
              min={8}
              max={GEN_MAX_LENGTH}
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
        </>
      )}

      <button
        onClick={copyCurrent}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90"
      >
        {t("generator.copyPassword")}
      </button>

      {/* Recent generated passwords (kept in memory, cleared on lock) */}
      <div className="space-y-2 rounded-lg border border-border bg-card/50 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("generator.recent", { count: history.length })}
          </span>
          {history.length > 0 && (
            <button
              onClick={() =>
                void bg({ type: "clearGenHistory" }).then(refreshHistory)
              }
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("common:clear")}
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("generator.empty")}
          </p>
        ) : (
          <ul className="space-y-1">
            {[...history].reverse().map((h) => (
              <li key={h.id} className="flex items-center gap-2">
                <code className="flex-1 truncate font-mono text-xs">
                  {h.password}
                </code>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {relativeAge(h.createdAt, t)}
                </span>
                <button
                  onClick={() => copyOnly(h.password)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  title={t("common:copy")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2 pt-1 text-xs">
          <label className="flex items-center gap-1.5 text-muted-foreground">
            {t("generator.keep")}
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
            {t("generator.expire")}
            <select
              value={cfg.historyTtlMin}
              onChange={(e) => update({ historyTtlMin: Number(e.target.value) })}
              className="rounded-md border border-border bg-card px-1.5 py-0.5"
            >
              <option value={15}>{t("generator.expireOptions.15m")}</option>
              <option value={60}>{t("generator.expireOptions.1h")}</option>
              <option value={240}>{t("generator.expireOptions.4h")}</option>
              <option value={1440}>{t("generator.expireOptions.24h")}</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

// ── Send tab (not yet supported server-side) ────────────────────────────────
function SendTab() {
  const { t } = useTranslation();
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <SendIcon className="h-6 w-6" />
      </span>
      <p className="text-sm font-medium">{t("send.title")}</p>
      <p className="text-xs text-muted-foreground">
        {t("send.body")}
      </p>
    </div>
  );
}

// ── Notifications tab ────────────────────────────────────────────────────
function UpdateAlert({ info }: { info: UpdateInfo }) {
  const { t } = useTranslation();
  const current = browser.runtime.getManifest().version;
  const hasSeverity = info.severity && info.severity !== "none";
  return (
    <div className="rounded-lg border border-brand/30 bg-brand/10 p-3">
      <div className="flex items-start gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand">
          <ArrowUpCircle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold">
            {hasSeverity
              ? t("update.availableWithSeverity", {
                  version: info.latestVersion,
                  severity: info.severity,
                })
              : t("update.available", { version: info.latestVersion })}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {t("update.autoUpdateNote", { current })}
          </div>
          {info.releaseUrl && (
            <a
              href={info.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-brand hover:underline"
            >
              {t("update.releaseNotes")} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationsTab({
  captures,
  vaults,
  activeVaultId,
  update,
  onSave,
  onDismiss,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
}: {
  captures: CapturedLoginSummary[];
  vaults: VaultMeta[];
  activeVaultId: string;
  update: UpdateInfo | null;
  onSave: (id: string, vaultId?: string) => void;
  onDismiss: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
}) {
  const { t } = useTranslation();
  const unread = captures.reduce((n, c) => (c.read ? n : n + 1), 0);
  // Per-capture chosen save target, defaulting to the active vault. A capture
  // already stored under a matching username updates in place regardless, so
  // the target only steers brand-new logins.
  const [targets, setTargets] = useState<Record<string, string>>({});
  const targetFor = (id: string) => targets[id] ?? activeVaultId;

  if (captures.length === 0) {
    if (update) {
      return (
        <div className="animate-fade-in space-y-2 p-3">
          <UpdateAlert info={update} />
        </div>
      );
    }
    return (
      <div className="animate-fade-in flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Bell className="h-6 w-6" />
        </span>
        <p className="text-sm font-medium">{t("notifications.title")}</p>
        <p className="text-xs text-muted-foreground">
          {t("notifications.body")}
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-2 p-3">
      {update && <UpdateAlert info={update} />}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {unread > 0 ? t("notifications.unread", { count: unread }) : t("notifications.allCaughtUp")}
        </span>
        <div className="flex items-center gap-3 text-xs">
          {unread > 0 && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t("notifications.markAllRead")}
            </button>
          )}
          <button
            onClick={onClearAll}
            className="flex items-center gap-1 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("common:clearAll")}
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
              {capture.kind === "credit_card" ? (
                <CreditCard className="h-3.5 w-3.5" />
              ) : capture.kind === "identity" ? (
                <User className="h-3.5 w-3.5" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {!capture.read && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">
                {capture.kind === "credit_card"
                  ? t("notifications.saveCard")
                  : capture.kind === "identity"
                    ? t("notifications.saveAddress")
                    : t("notifications.savePrompt", {
                        host: safeHostname(capture.url),
                      })}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {capture.kind === "credit_card" || capture.kind === "identity"
                  ? t("notifications.itemMeta", {
                      title: capture.title || t("notifications.noTitle"),
                      age: relativeAge(capture.capturedAt, t),
                    })
                  : t("notifications.captureMeta", {
                      username: capture.username || t("notifications.noUsername"),
                      age: relativeAge(capture.capturedAt, t),
                    })}
              </div>
              {vaults.length > 1 && (
                <label className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                  {t("notifications.saveTo")}
                  <select
                    value={targetFor(capture.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      setTargets((prev) => ({ ...prev, [capture.id]: e.target.value }));
                    }}
                    className="min-w-0 flex-1 rounded border border-border bg-card px-1 py-0.5 text-[10px]"
                  >
                    {vaults.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.type === "shared"
                          ? t("vault.sharedOption", { name: v.name })
                          : v.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSave(capture.id, targetFor(capture.id));
                }}
                className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t("common:save")}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(capture.id);
                }}
                title={t("common:dismiss")}
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
  showWhenLocked: boolean;
  savePrompt: boolean;
  toastMs: number;
  relaxedMatch: boolean;
  breachCheck: boolean;
  suggestPassword: boolean;
  updateNotify: UpdateNotifyLevel;
  genMode: GenMode;
  genLength: number;
  genLower: boolean;
  genUpper: boolean;
  genDigits: boolean;
  genSymbols: boolean;
  genWords: number;
  genWordSep: string;
  genWordCaps: boolean;
  genWordDigit: boolean;
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
  const { t } = useTranslation();
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
      setLocalError(t("settings.biometricErrors.missingFields"));
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
      if (code === "INVALID_CREDENTIALS") setLocalError(t("settings.biometricErrors.invalidCredentials"));
      else if (code === "RATE_LIMITED") setLocalError(t("settings.biometricErrors.rateLimited"));
      else setLocalError(err instanceof Error ? err.message : t("settings.biometricErrors.enableFailed"));
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
        {t("settings.security")}
      </div>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm">
            <Fingerprint className="h-3.5 w-3.5 text-brand" />
            {t("settings.biometricUnlock")}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {enrolled
              ? t("settings.biometricEnrolledHint")
              : t("settings.biometricSetupHint")}
          </span>
        </span>
        {enrolled ? (
          <button
            type="button"
            onClick={disable}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/60"
          >
            {t("common:disable")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEnrolling((v) => !v)}
            className="shrink-0 rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-xs text-brand hover:bg-brand/15"
          >
            {enrolling ? t("common:cancel") : t("common:enable")}
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
            placeholder={t("email.placeholder")}
            autoComplete="email"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-brand/60"
          />
          <input
            type="password"
            value={enrollPassword}
            onChange={(e) => setEnrollPassword(e.target.value)}
            placeholder={t("password.placeholder")}
            autoComplete="current-password"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus:border-brand/60"
          />
          <button
            type="button"
            onClick={beginEnroll}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("settings.biometricConfirm")}
          </button>
        </div>
      )}
    </div>
  );
}

// Lists the hosts the user has opted out of save prompts for, with a control to
// re-enable each. Hidden entirely when the list is empty so it never clutters
// settings until the user has actually opted a site out.
function NeverSaveCard() {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    bg<{ hosts?: string[] }>({ type: "listNeverSaveHosts" }).then((res) => {
      if (!cancelled) setHosts(res?.hosts ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function remove(host: string) {
    setHosts((prev) => prev.filter((h) => h !== host));
    void bg({ type: "removeNeverSaveHost", host });
  }

  if (hosts.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Ban className="h-3.5 w-3.5" />
        {t("settings.neverSave")}
      </div>
      <p className="text-[11px] text-muted-foreground">{t("settings.neverSaveHint")}</p>
      <ul className="space-y-1">
        {hosts.map((host) => (
          <li key={host} className="flex items-center gap-2">
            <span className="flex-1 truncate text-xs">{host}</span>
            <button
              onClick={() => remove(host)}
              className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            >
              {t("settings.neverSaveAllow")}
            </button>
          </li>
        ))}
      </ul>
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
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ExtSettings | null>(null);
  const [lang, setLang] = useState<Language>(currentLanguage());

  async function handleLanguageChange(next: Language) {
    setLang(next);
    await changeLanguage(next);
  }

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
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("settings.server")}</div>
        <div className="mt-1 truncate text-sm">{safeHostname(serverUrl) || t("settings.notSet")}</div>
      </div>

      {settings && (
        <div className="space-y-2 rounded-lg border border-border bg-card/50 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.autofillSaving")}
          </div>
          <Toggle
            label={t("settings.fieldIcon")}
            hint={t("settings.fieldIconHint")}
            checked={settings.fieldIcon}
            onChange={(v) => update({ fieldIcon: v })}
          />
          <Toggle
            label={t("settings.showWhenLocked")}
            hint={t("settings.showWhenLockedHint")}
            checked={settings.showWhenLocked}
            onChange={(v) => update({ showWhenLocked: v })}
          />
          <Toggle
            label={t("settings.autofill")}
            hint={t("settings.autofillHint")}
            checked={settings.autofill}
            onChange={(v) => update({ autofill: v })}
          />
          <Toggle
            label={t("settings.savePromptLabel")}
            hint={t("settings.savePromptHint")}
            checked={settings.savePrompt}
            onChange={(v) => update({ savePrompt: v })}
          />
          <Toggle
            label={t("settings.suggestPassword")}
            hint={t("settings.suggestPasswordHint")}
            checked={settings.suggestPassword}
            onChange={(v) => update({ suggestPassword: v })}
          />
          <Toggle
            label={t("settings.relaxedMatch")}
            hint={t("settings.relaxedMatchHint")}
            checked={settings.relaxedMatch}
            onChange={(v) => update({ relaxedMatch: v })}
          />
          <Toggle
            label={t("settings.breachCheck")}
            hint={t("settings.breachCheckHint")}
            checked={settings.breachCheck}
            onChange={(v) => update({ breachCheck: v })}
          />
          <label className="flex items-center justify-between gap-3 pt-1">
            <span className="min-w-0">
              <span className="block text-sm">{t("settings.promptTimeout")}</span>
              <span className="block text-[11px] text-muted-foreground">
                {t("settings.promptTimeoutHint")}
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
              <span className="block text-sm">{t("settings.autoLock")}</span>
              <span className="block text-[11px] text-muted-foreground">
                {t("settings.autoLockHint")}
              </span>
            </span>
            <select
              value={settings.autoLockMin}
              onChange={(e) => update({ autoLockMin: Number(e.target.value) })}
              className="shrink-0 rounded-md border border-border bg-card px-2 py-1 text-xs"
            >
              <option value={1}>{t("settings.autoLockOptions.1min")}</option>
              <option value={5}>{t("settings.autoLockOptions.5min")}</option>
              <option value={15}>{t("settings.autoLockOptions.15min")}</option>
              <option value={30}>{t("settings.autoLockOptions.30min")}</option>
              <option value={60}>{t("settings.autoLockOptions.1hour")}</option>
              <option value={0}>{t("settings.autoLockOptions.untilClose")}</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 pt-1">
            <span className="min-w-0">
              <span className="block text-sm">{t("settings.updateAlerts")}</span>
              <span className="block text-[11px] text-muted-foreground">
                {t("settings.updateAlertsHint")}
              </span>
            </span>
            <select
              value={settings.updateNotify}
              onChange={(e) =>
                update({ updateNotify: e.target.value as UpdateNotifyLevel })
              }
              className="shrink-0 rounded-md border border-border bg-card px-2 py-1 text-xs"
            >
              <option value="all">{t("settings.updateNotifyOptions.all")}</option>
              <option value="minor">{t("settings.updateNotifyOptions.minor")}</option>
              <option value="major">{t("settings.updateNotifyOptions.major")}</option>
              <option value="off">{t("settings.updateNotifyOptions.off")}</option>
            </select>
          </label>

          <label className="flex items-center justify-between gap-3 pt-1">
            <span className="min-w-0">
              <span className="block text-sm">{t("settings.language")}</span>
              <span className="block text-[11px] text-muted-foreground">
                {t("settings.languageHint")}
              </span>
            </span>
            <select
              value={lang}
              onChange={(e) => void handleLanguageChange(e.target.value as Language)}
              className="shrink-0 rounded-md border border-border bg-card px-2 py-1 text-xs"
            >
              {SUPPORTED_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_NAMES[code]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <NeverSaveCard />

      <BiometricSetting
        serverUrl={serverUrl}
        accountEmail={accountEmail}
        available={biometricAvailable}
        enrolled={biometricEnrolled}
        onChange={onBiometricChange}
      />

      <button
        onClick={() => openImport(serverUrl)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-accent/60"
      >
        <Download className="h-4 w-4 text-muted-foreground" />
        {t("settings.importPasswords")}
      </button>
      <button
        onClick={() =>
          isSafeHttpUri(serverUrl) &&
          window.open(serverUrl, "_blank", "noopener,noreferrer")
        }
        className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-accent/60"
      >
        <ExternalLink className="h-4 w-4 text-muted-foreground" />
        {t("settings.openWebVault")}
      </button>
      <button
        onClick={onLock}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-accent/60"
      >
        <Lock className="h-4 w-4 text-muted-foreground" />
        {t("settings.lockVault")}
      </button>
      <UpdateCard />
      <AboutCard />
    </div>
  );
}

interface UpdateInfo {
  ok: boolean;
  enabled: boolean;
  currentVersion: string;
  latestVersion?: string;
  severity?: string;
  updateAvailable: boolean;
  releaseNotes?: string;
  releaseUrl?: string;
}

const WHATSNEW_KEY = "vaultctl_whatsnew_version";

// UpdateCard: checks the connected server for the latest release, compares it
// to this extension's version, and shows a one-time "what's new" after the
// browser auto-updates the extension (recorded by background onInstalled).
function UpdateCard() {
  const { t } = useTranslation();
  const current = browser.runtime.getManifest().version;
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [whatsNew, setWhatsNew] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await bg<UpdateInfo>({ type: "checkUpdate" });
      if (res?.ok) setInfo(res);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    void browser.storage.local.get(WHATSNEW_KEY).then((stored) => {
      const v = stored[WHATSNEW_KEY] as string | undefined;
      if (v && v === current) setWhatsNew(v);
    });
  }, [check, current]);

  function dismissWhatsNew() {
    setWhatsNew(null);
    void browser.storage.local.remove(WHATSNEW_KEY);
  }

  const notes = info?.releaseNotes?.trim();

  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-card/50 p-3">
      {whatsNew && (
        <div className="rounded-md border border-brand/30 bg-brand/10 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-brand">
              {t("update.updatedTo", { version: whatsNew })}
            </span>
            <button
              onClick={dismissWhatsNew}
              aria-label={t("common:dismiss")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {notes && (
            <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-line text-[11px] text-muted-foreground">
              {notes}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{t("update.heading")}</span>
        <button
          onClick={() => void check()}
          disabled={checking}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
          {t("update.check")}
        </button>
      </div>

      {info && !info.enabled && (
        <p className="text-[11px] text-muted-foreground">
          {t("update.checkingOff")}
        </p>
      )}

      {info && info.enabled && !info.updateAvailable && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="h-3 w-3 text-brand" /> {t("update.onLatest", { current })}
        </p>
      )}

      {info && info.updateAvailable && (
        <div className="space-y-1.5">
          <p className="text-[11px]">
            <Trans
              i18nKey={
                info.severity && info.severity !== "none"
                  ? "update.cardLineSeverity"
                  : "update.cardLine"
              }
              values={{
                version: info.latestVersion,
                severity: info.severity,
                current,
              }}
              components={{ version: <span className="font-medium text-brand" /> }}
            />
          </p>
          <div className="flex items-center gap-2">
            {notes && (
              <button
                onClick={() => setShowNotes((v) => !v)}
                className="text-[11px] text-brand hover:underline"
              >
                {showNotes ? t("update.hide") : t("update.whatsNew")}
              </button>
            )}
            {info.releaseUrl && (
              <a
                href={info.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {t("update.release")} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          {showNotes && notes && (
            <p className="max-h-32 overflow-y-auto whitespace-pre-line rounded-md border border-border bg-background/50 p-2 text-[11px] text-muted-foreground">
              {notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AboutCard() {
  const { t } = useTranslation();
  const version = browser.runtime.getManifest().version;
  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-card/50 p-3">
      <div className="flex flex-col items-center gap-0.5">
        <BrandMark className="text-5xl text-brand" />
        <BrandMark variant="wordmark" className="block text-lg" />
      </div>
      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        {t("about.tagline")}
      </p>

      <dl className="space-y-1 border-t border-border pt-2 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t("about.version")}</dt>
          <dd className="font-mono">{version}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t("about.maintainedBy")}</dt>
          <dd>Vineeth N K</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{t("about.craftedFrom")}</dt>
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
          {t("common:documentation")}
        </a>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-brand"
        >
          <Mail className="h-3.5 w-3.5" />
          {t("common:support")}
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

// A live 2FA code derived locally from the item's stored secret (the secret
// never leaves the popup). Re-derives each second and on period rollover, with
// a copy button. Renders nothing if the stored value isn't a valid secret.
function TotpChip({ secret, onCopied }: { secret: string; onCopied: () => void }) {
  const params = useTotpParams(secret);
  const [code, setCode] = useState("");
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    const tick = async () => {
      const next = await generateTotp(params);
      if (!cancelled) {
        setCode(next);
        setRemaining(secondsRemaining(params.period));
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [params]);

  if (!params || !code) return null;
  const grouped = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void copySecret(code).then((ok) => ok && onCopied());
      }}
      className="mt-0.5 flex items-center gap-1.5 text-[11px] text-brand hover:opacity-80"
      title={`2FA · expires in ${remaining}s`}
    >
      <KeyRound className="h-3 w-3" />
      <span className="font-mono tracking-wide">{grouped}</span>
      <span className="text-muted-foreground">{remaining}s</span>
    </button>
  );
}

// Parse the stored secret once per value; invalid secrets yield null so the chip
// renders nothing rather than throwing.
function useTotpParams(secret: string): TotpParams | null {
  const [params, setParams] = useState<TotpParams | null>(null);
  useEffect(() => {
    try {
      setParams(parseTotp(secret));
    } catch {
      setParams(null);
    }
  }, [secret]);
  return params;
}

// Password checkup: counts weak and reused passwords locally, and (when the
// opt-in breach check is on) how many are compromised per HIBP. Renders a
// collapsible card above the list only when there's something to report.
function PasswordCheckup({
  items,
  breachCheck,
  serverUrl,
}: {
  items: DecryptedItem[];
  breachCheck: boolean;
  serverUrl: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [compromised, setCompromised] = useState<Set<string> | null>(null);

  const logins = items.filter((i) => i.itemType === "login" && i.password);
  const reusedSet = reusedPasswords(logins.map((l) => l.password));
  const weak = logins.filter((l) => isWeakPassword(l.password));
  const reused = logins.filter((l) => reusedSet.has(l.password));

  useEffect(() => {
    if (!breachCheck) {
      setCompromised(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const unique = [...new Set(logins.map((l) => l.password))];
      const bad = new Set<string>();
      for (const password of unique) {
        if ((await breachCount(password)) > 0) bad.add(password);
      }
      if (!cancelled) setCompromised(bad);
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when the set of items changes (load / vault switch) or the toggle flips.
  }, [breachCheck, items]);

  const compromisedItems = compromised
    ? logins.filter((l) => compromised.has(l.password))
    : [];
  const total = weak.length + reused.length + compromisedItems.length;
  if (logins.length === 0 || total === 0) return null;

  const parts: string[] = [];
  if (compromisedItems.length)
    parts.push(t("checkup.compromised", { count: compromisedItems.length }));
  if (reused.length) parts.push(t("checkup.reused", { count: reused.length }));
  if (weak.length) parts.push(t("checkup.weak", { count: weak.length }));

  return (
    <div className="px-3 pt-2.5">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-500">
            <ShieldAlert className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold">{t("checkup.title")}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {parts.join(" · ")}
            </span>
          </span>
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
        </button>
        {open && (
          <div className="mt-2 space-y-1.5 border-t border-amber-500/20 pt-2">
            {compromisedItems.length > 0 && (
              <CheckupGroup label={t("checkup.compromisedGroup")} items={compromisedItems} />
            )}
            {reused.length > 0 && (
              <CheckupGroup label={t("checkup.reusedGroup")} items={reused} />
            )}
            {weak.length > 0 && (
              <CheckupGroup label={t("checkup.weakGroup")} items={weak} />
            )}
            {isSafeHttpUri(serverUrl) && (
              <button
                onClick={() =>
                  window.open(
                    `${serverUrl.replace(/\/$/, "")}/health`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
              >
                {t("checkup.openCenter")} <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CheckupGroup({ label, items }: { label: string; items: DecryptedItem[] }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="truncate text-[11px]">
        {items.map((i) => i.name).join(", ")}
      </div>
    </div>
  );
}

function ItemTypeIcon({ itemType }: { itemType: string }) {
  if (itemType === "credit_card") return <CreditCard className="h-4 w-4" />;
  if (itemType === "identity") return <User className="h-4 w-4" />;
  return <KeyRound className="h-4 w-4" />;
}

interface DetailField {
  key: string;
  secret?: boolean;
  multiline?: boolean;
  uri?: boolean;
}

const DETAIL_FIELDS: Record<string, DetailField[]> = {
  login: [
    { key: "username" },
    { key: "password", secret: true },
    { key: "uri", uri: true },
    { key: "totp", secret: true },
    { key: "notes", multiline: true },
  ],
  secure_note: [
    { key: "content", multiline: true },
    { key: "notes", multiline: true },
  ],
  credit_card: [
    { key: "cardholderName" },
    { key: "number", secret: true },
    { key: "expiry" },
    { key: "cvv", secret: true },
    { key: "cardType" },
    { key: "notes", multiline: true },
  ],
  identity: [
    { key: "firstName" },
    { key: "lastName" },
    { key: "email" },
    { key: "phone" },
    { key: "address" },
    { key: "city" },
    { key: "state" },
    { key: "country" },
    { key: "postalCode" },
    { key: "ssn", secret: true },
    { key: "passportNumber", secret: true },
    { key: "licenseNumber", secret: true },
    { key: "notes", multiline: true },
  ],
  api_key: [
    { key: "key", secret: true },
    { key: "environment" },
    { key: "serviceUrl", uri: true },
    { key: "expiresAt" },
    { key: "notes", multiline: true },
  ],
  ssh_key: [
    { key: "keyType" },
    { key: "host" },
    { key: "fingerprint" },
    { key: "publicKey", multiline: true },
    { key: "privateKey", secret: true, multiline: true },
    { key: "passphrase", secret: true },
    { key: "notes", multiline: true },
  ],
  passkey: [
    { key: "rpName" },
    { key: "rpId" },
    { key: "userHandle" },
    { key: "credentialId" },
    { key: "notes", multiline: true },
  ],
};

function ItemDetail({
  item,
  data,
  error,
  onBack,
  onCopy,
  t,
}: {
  item: DecryptedItem;
  data: Record<string, unknown> | null;
  error: boolean;
  onBack: () => void;
  onCopy: (text: string, label: string) => void;
  t: TFunction;
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const fields = DETAIL_FIELDS[item.itemType] ?? [];
  const rows = fields
    .map((field) => ({ field, value: String(data?.[field.key] ?? "") }))
    .filter((row) => row.value.trim() !== "");
  const customFields = Array.isArray(data?.customFields)
    ? (data.customFields as { name?: string; value?: string }[]).filter(
        (custom) => (custom.value ?? "").trim() !== "",
      )
    : [];

  return (
    <div className="animate-fade-in">
      <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur-sm">
        <button
          onClick={onBack}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t("common:cancel")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white" style={avatarStyle(item.name)}>
          <ItemTypeIcon itemType={item.itemType} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{item.name}</div>
          <div className="text-xs text-muted-foreground">
            {t(`vault.itemTypes.${item.itemType}`)}
          </div>
        </div>
      </div>

      <div className="space-y-2 p-3">
        {error ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("vault.detail.decryptFailed")}
          </p>
        ) : !data ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("common:loading")}
          </p>
        ) : rows.length === 0 && customFields.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("vault.detail.empty")}
          </p>
        ) : (
          <>
            {rows.map(({ field, value }) => (
              <DetailRow
                key={field.key}
                label={t(`vault.detail.fields.${field.key}`)}
                value={value}
                secret={field.secret ?? false}
                multiline={field.multiline ?? false}
                uri={field.uri ?? false}
                revealed={revealed.has(field.key)}
                onToggle={() => toggle(field.key)}
                onCopy={() => onCopy(value, t(`vault.detail.fields.${field.key}`))}
                t={t}
              />
            ))}
            {customFields.map((custom, index) => {
              const label = custom.name || t("vault.detail.customField");
              return (
                <DetailRow
                  key={`custom-${index}`}
                  label={label}
                  value={custom.value ?? ""}
                  secret={false}
                  multiline={false}
                  uri={false}
                  revealed
                  onToggle={() => {}}
                  onCopy={() => onCopy(custom.value ?? "", label)}
                  t={t}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  secret,
  multiline,
  uri,
  revealed,
  onToggle,
  onCopy,
  t,
}: {
  label: string;
  value: string;
  secret: boolean;
  multiline: boolean;
  uri: boolean;
  revealed: boolean;
  onToggle: () => void;
  onCopy: () => void;
  t: TFunction;
}) {
  const hidden = secret && !revealed;
  const display = hidden ? "•".repeat(Math.min(value.length, 12)) : value;

  return (
    <div className="rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {secret && (
            <button
              onClick={onToggle}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title={revealed ? t("vault.detail.hide") : t("vault.detail.reveal")}
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
          {uri && isSafeHttpUri(value) && (
            <button
              onClick={() => window.open(value, "_blank", "noopener,noreferrer")}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t("vault.openSite")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onCopy}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t("common:copy")}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div
        className={`mt-1 text-sm ${
          multiline && !hidden ? "whitespace-pre-wrap break-words" : "break-words"
        } ${hidden ? "tracking-widest text-muted-foreground" : ""}`}
      >
        {display}
      </div>
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

// Open the web vault's import screen (Settings -> Data, deep-linked) in a new
// tab. Browser extensions can't import files themselves, so this hands off to
// the web client where the import/export UI lives.
function openImport(serverUrl: string) {
  if (!isSafeHttpUri(serverUrl)) return;
  const base = serverUrl.replace(/\/$/, "");
  window.open(`${base}/settings?tab=data`, "_blank", "noopener,noreferrer");
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
