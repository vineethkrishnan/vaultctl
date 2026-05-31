// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { apiGet, apiPut, apiDelete } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { decryptData, decryptName } from "@/lib/key-holder";
import { relativeAge } from "@/lib/time";
import { useClipboard } from "@/hooks/use-clipboard";
import type { ItemResponse } from "@/shared/types/api";
import {
  KeyRound,
  FileText,
  CreditCard,
  User,
  Key,
  Terminal,
  Fingerprint,
  Star,
  Search,
  MoreVertical,
  Copy,
  ClipboardCopy,
  Trash2,
  Check,
} from "lucide-react";

const ITEM_TYPE_ICONS: Record<string, typeof KeyRound> = {
  login: KeyRound,
  secure_note: FileText,
  credit_card: CreditCard,
  identity: User,
  api_key: Key,
  ssh_key: Terminal,
  passkey: Fingerprint,
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  login: "Login",
  secure_note: "Secure Note",
  credit_card: "Credit Card",
  identity: "Identity",
  api_key: "API Key",
  ssh_key: "SSH Key",
  passkey: "Passkey",
};

const decoder = new TextDecoder();

interface DecryptedItem extends ItemResponse {
  decryptedName: string;
  username?: string;
  password?: string;
  uri?: string;
}

// Deterministic gradient per item name — gives each row a scannable identity.
function avatarStyle(name: string): CSSProperties {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 52% 46%), hsl(${(hue + 45) % 360} 58% 38%))`,
  };
}

function itemToText(item: DecryptedItem): string {
  const lines = [item.decryptedName];
  if (item.username) lines.push(`Username: ${item.username}`);
  if (item.password) lines.push(`Password: ${item.password}`);
  if (item.uri) lines.push(`URI: ${item.uri}`);
  return lines.join("\n");
}

export function ItemList() {
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const search = useSearch({ strict: false }) as {
    favorites?: boolean;
    folderId?: string;
  };
  const queryClient = useQueryClient();
  const { copy } = useClipboard();

  const queryParams = new URLSearchParams();
  if (search.favorites) queryParams.set("favorites", "true");
  if (search.folderId) queryParams.set("folderId", search.folderId);
  const qs = queryParams.toString();

  const {
    data: items,
    isLoading,
    error,
  } = useQuery({
    queryKey: [...queryKeys.items.list(vaultId), qs],
    queryFn: () =>
      apiGet<ItemResponse[]>(
        `/api/v1/vaults/${vaultId}/items${qs ? `?${qs}` : ""}`,
      ),
    enabled: !!vaultId && vaultId !== "none",
  });

  const [decryptedItems, setDecryptedItems] = useState<DecryptedItem[]>([]);
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!items) return;
    let cancelled = false;

    async function decrypt() {
      const results: DecryptedItem[] = [];
      for (const item of items!) {
        let decryptedName = "[decryption failed]";
        let username: string | undefined;
        let password: string | undefined;
        let uri: string | undefined;
        try {
          decryptedName = await decryptName(vaultId, item.encryptedName);
        } catch {
          // keep the failure placeholder
        }
        // Reprompt items require a step-up before their data can be read, so we
        // never decrypt their secrets in the list.
        if (!item.reprompt) {
          try {
            const raw = JSON.parse(
              decoder.decode(await decryptData(vaultId, item.encryptedData)),
            ) as { username?: string; password?: string; uri?: string };
            username = raw.username || undefined;
            password = raw.password || undefined;
            uri = raw.uri || undefined;
          } catch {
            // data unavailable — row still shows name + type
          }
        }
        results.push({ ...item, decryptedName, username, password, uri });
      }
      if (!cancelled) setDecryptedItems(results);
    }

    decrypt();
    return () => {
      cancelled = true;
    };
  }, [items, vaultId]);

  const presentTypes = useMemo(() => {
    const seen = new Set<string>();
    for (const item of decryptedItems) seen.add(item.itemType);
    return [...seen];
  }, [decryptedItems]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return decryptedItems.filter((i) => {
      if (typeFilter !== "all" && i.itemType !== typeFilter) return false;
      if (!needle) return true;
      return (
        i.decryptedName.toLowerCase().includes(needle) ||
        (i.username?.toLowerCase().includes(needle) ?? false) ||
        (i.uri?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [decryptedItems, filter, typeFilter]);

  const favoriteMutation = useMutation({
    mutationFn: (item: DecryptedItem) =>
      apiPut(`/api/v1/vaults/${vaultId}/items/${item.id}`, {
        encryptedName: item.encryptedName,
        encryptedData: item.encryptedData,
        favorite: !item.favorite,
        reprompt: item.reprompt,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all(vaultId) }),
  });

  const trashMutation = useMutation({
    mutationFn: (item: DecryptedItem) =>
      apiDelete(`/api/v1/vaults/${vaultId}/items/${item.id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all(vaultId) }),
  });

  function flashCopied(label: string) {
    setCopied(label);
    window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1800);
  }

  function handleCopy(text: string, label: string) {
    void copy(text).then(() => flashCopied(label));
  }

  function handleDelete(item: DecryptedItem) {
    if (
      !window.confirm(`Move "${item.decryptedName}" to trash?`)
    ) {
      return;
    }
    trashMutation.mutate(item);
  }

  if (vaultId === "none") {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card/40 py-20 text-center">
        <p className="text-muted-foreground">No vaults found.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card/40">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3.5 px-4 py-3">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-16 animate-pulse rounded bg-muted/70" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load items
      </div>
    );
  }

  if (!decryptedItems.length) {
    return (
      <div className="animate-scale-in flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 py-20 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
          <KeyRound className="h-6 w-6" />
        </div>
        <p className="text-lg font-medium">No items yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create your first item to get started.
        </p>
        <Link
          to="/vault/$vaultId/items/new"
          params={{ vaultId }}
          className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:-translate-y-0.5 hover:bg-primary/90"
        >
          Create Item
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search name, username or URL"
            className="w-full rounded-lg border border-border bg-card/50 py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter by type"
          className="rounded-lg border border-border bg-card/50 px-3 py-2.5 text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20 sm:w-44"
        >
          <option value="all">All types</option>
          {presentTypes.map((t) => (
            <option key={t} value={t}>
              {ITEM_TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      </div>

      {!visible.length ? (
        <div className="rounded-xl border border-border bg-card/40 py-12 text-center text-sm text-muted-foreground">
          No items match {filter ? `"${filter}"` : "this filter"}.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card/40 backdrop-blur-sm">
          {visible.map((item, i) => {
            const Icon = ITEM_TYPE_ICONS[item.itemType] ?? KeyRound;
            const typeLabel = ITEM_TYPE_LABELS[item.itemType] ?? item.itemType;
            return (
              <div
                key={item.id}
                style={{ animationDelay: `${Math.min(i, 18) * 28}ms` }}
                className="row-interactive animate-fade-up group flex items-center gap-3.5 border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-accent/50"
              >
                <Link
                  to="/vault/$vaultId/items/$itemId"
                  params={{ vaultId, itemId: item.id }}
                  className="flex min-w-0 flex-1 items-center gap-3.5"
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white shadow-sm transition-transform duration-200 group-hover:scale-105"
                    style={avatarStyle(item.decryptedName)}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {item.decryptedName}
                    </div>
                    <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <span className="shrink-0">{typeLabel}</span>
                      {item.username && (
                        <>
                          <span className="inline-block h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
                          <span className="truncate">{item.username}</span>
                        </>
                      )}
                    </div>
                  </div>
                </Link>
                <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">
                  {relativeAge(item.updatedAt)}
                </span>
                {item.favorite && (
                  <Star className="h-4 w-4 shrink-0 fill-yellow-500 text-yellow-500" />
                )}
                <RowMenu
                  item={item}
                  onCopyUsername={() =>
                    item.username && handleCopy(item.username, "username")
                  }
                  onCopyPassword={() =>
                    item.password && handleCopy(item.password, "password")
                  }
                  onCopyItem={() => handleCopy(itemToText(item), "item")}
                  onToggleFavorite={() => favoriteMutation.mutate(item)}
                  onDelete={() => handleDelete(item)}
                />
              </div>
            );
          })}
        </div>
      )}

      {copied && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-foreground shadow-lg">
          <Check className="h-3.5 w-3.5 text-brand" />
          Copied {copied} - clipboard clears in 30s
        </div>
      )}
    </div>
  );
}

function RowMenu({
  item,
  onCopyUsername,
  onCopyPassword,
  onCopyItem,
  onToggleFavorite,
  onDelete,
}: {
  item: DecryptedItem;
  onCopyUsername: () => void;
  onCopyPassword: () => void;
  onCopyItem: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(t) &&
        btnRef.current &&
        !btnRef.current.contains(t)
      ) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // A fixed-positioned menu would detach from the button on scroll.
    function close() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function run(action: () => void) {
    action();
    setOpen(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Item actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: coords.top, right: coords.right }}
            className="animate-scale-in z-50 w-48 overflow-hidden rounded-lg border border-border bg-popover py-1 text-sm shadow-xl"
          >
            {item.username && (
              <MenuItem icon={Copy} label="Copy username" onClick={() => run(onCopyUsername)} />
            )}
            {item.password && (
              <MenuItem icon={Copy} label="Copy password" onClick={() => run(onCopyPassword)} />
            )}
            <MenuItem icon={ClipboardCopy} label="Copy item" onClick={() => run(onCopyItem)} />
            <MenuItem
              icon={Star}
              label={item.favorite ? "Remove favorite" : "Add to favorites"}
              onClick={() => run(onToggleFavorite)}
            />
            <div className="my-1 border-t border-border" />
            <MenuItem
              icon={Trash2}
              label="Move to trash"
              destructive
              onClick={() => run(onDelete)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent ${
        destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );
}

export { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS };
