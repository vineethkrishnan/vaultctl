// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect } from "react";
import { Shield, Search, Copy, Lock, ExternalLink, Save } from "lucide-react";

type View = "locked" | "login" | "list" | "search";

interface VaultItem {
  id: string;
  name: string;
  type: string;
  username?: string;
  uri?: string;
}

interface CapturedLoginSummary {
  id: string;
  url: string;
  username: string;
  capturedAt: number;
}

export function Popup() {
  const [view, setView] = useState<View>("login");
  const [serverUrl, setServerUrl] = useState("");
  // Vault items are loaded from the background once the crypto state is
  // unlocked. For v1 the popup renders an empty list until the M11
  // API-sync work lands; the setter is intentionally kept for that hook-up.
  const [items, setItems] = useState<VaultItem[]>([]);
  void setItems;
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [captures, setCaptures] = useState<CapturedLoginSummary[]>([]);

  // Load server URL from background (storage.local) — popup cannot use
  // localStorage reliably across SW restarts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = (await browser.runtime.sendMessage({
          type: "getServerUrl",
        })) as { url?: string } | undefined;
        if (!cancelled && response?.url) {
          setServerUrl(response.url);
        }
      } catch {
        // background not yet alive — use empty string
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Query auth state + captured logins from the background
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authState = (await browser.runtime.sendMessage({
          type: "getAuthState",
        })) as { isAuthenticated?: boolean; isUnlocked?: boolean } | undefined;
        if (!cancelled && (authState?.isAuthenticated || authState?.isUnlocked)) {
          setView("list");
        }

        const capturesResponse = (await browser.runtime.sendMessage({
          type: "getCapturedLogins",
        })) as { captures?: CapturedLoginSummary[] } | undefined;
        if (!cancelled && capturesResponse?.captures) {
          setCaptures(capturesResponse.captures);
        }
      } catch {
        // background unreachable — stay on login view
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveCapture(captureId: string) {
    try {
      await browser.runtime.sendMessage({
        type: "consumeCapturedLogin",
        id: captureId,
      });
      setCaptures((existing) =>
        existing.filter((capture) => capture.id !== captureId),
      );
    } catch {
      // leave the capture in place so the user can retry
    }
  }

  function handleCopy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
    // Auto-clear clipboard after 30s
    setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 30_000);
  }

  // Login view
  if (view === "login") {
    return (
      <div className="flex flex-col items-center justify-center p-6 space-y-4">
        <Shield className="h-10 w-10 text-primary" />
        <h1 className="text-lg font-bold">vaultctl</h1>
        <p className="text-sm text-muted-foreground text-center">
          Connect to your vault server to get started.
        </p>

        <div className="w-full space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Server URL</label>
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://vault.example.com"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none"
            />
          </div>
          <button
            onClick={async () => {
              // Persist to background (storage.local) so the SW can read it
              // across restarts. Popup's own localStorage is session-scoped
              // and cleared when the popup closes.
              try {
                await browser.runtime.sendMessage({
                  type: "setServerUrl",
                  url: serverUrl,
                });
              } catch {
                // background might be cold-starting; non-fatal
              }
              if (serverUrl) {
                window.open(serverUrl, "_blank");
              }
            }}
            disabled={!serverUrl}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <ExternalLink className="h-4 w-4" />
            Open Vault
          </button>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Log in via the web vault. The extension will sync automatically.
        </p>
      </div>
    );
  }

  // List view (placeholder — real implementation reads from background service worker)
  const filtered = items.filter(
    (item) =>
      !searchQuery ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.uri?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Shield className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold flex-1">vaultctl</span>
        <button
          onClick={async () => {
            try {
              await browser.runtime.sendMessage({ type: "lock" });
            } catch {
              // ignore
            }
            setView("login");
          }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          title="Lock"
        >
          <Lock className="h-4 w-4" />
        </button>
      </div>

      {/* Captured logins — surface submit-interceptor hits so the user can
          save them into a vault. v1 surfaces the capture; real "save" flow
          lands with the M11 API-sync work. */}
      {captures.length > 0 && (
        <div className="border-b border-border px-3 py-2 space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Captured logins
          </div>
          {captures.map((capture) => (
            <div
              key={capture.id}
              className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5"
            >
              <Save className="h-3.5 w-3.5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">
                  {safeHostname(capture.url)}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {capture.username || "(no username)"}
                </div>
              </div>
              <button
                onClick={() => handleSaveCapture(capture.id)}
                className="shrink-0 rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground"
                title="Save captured login"
              >
                Save
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-md border border-input px-2 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search vault..."
            autoFocus
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto px-1">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? "No items in vault"
              : "No matches found"}
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.name}</div>
                {item.username && (
                  <div className="text-xs text-muted-foreground truncate">
                    {item.username}
                  </div>
                )}
              </div>
              {item.username && (
                <button
                  onClick={() => handleCopy(item.username!, "username")}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  title="Copy username"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Status bar */}
      {copied && (
        <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          Copied {copied} — clipboard clears in 30s
        </div>
      )}
    </div>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
