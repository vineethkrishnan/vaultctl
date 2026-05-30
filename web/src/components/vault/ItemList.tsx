// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { apiGet } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { decryptName } from "@/lib/key-holder";
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
  ChevronRight,
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

interface DecryptedItem extends ItemResponse {
  decryptedName: string;
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

export function ItemList() {
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const search = useSearch({ strict: false }) as {
    favorites?: boolean;
    folderId?: string;
  };

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

  useEffect(() => {
    if (!items) return;
    let cancelled = false;

    async function decrypt() {
      const results: DecryptedItem[] = [];
      for (const item of items!) {
        try {
          const name = await decryptName(vaultId, item.encryptedName);
          results.push({ ...item, decryptedName: name });
        } catch {
          results.push({ ...item, decryptedName: "[decryption failed]" });
        }
      }
      if (!cancelled) setDecryptedItems(results);
    }

    decrypt();
    return () => {
      cancelled = true;
    };
  }, [items, vaultId]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return decryptedItems;
    return decryptedItems.filter((i) => i.decryptedName.toLowerCase().includes(needle));
  }, [decryptedItems, filter]);

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
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search items"
          className="w-full rounded-lg border border-border bg-card/50 py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {!visible.length ? (
        <div className="rounded-xl border border-border bg-card/40 py-12 text-center text-sm text-muted-foreground">
          No items match "{filter}".
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card/40 backdrop-blur-sm">
          {visible.map((item, i) => {
            const Icon = ITEM_TYPE_ICONS[item.itemType] ?? KeyRound;
            return (
              <Link
                key={item.id}
                to="/vault/$vaultId/items/$itemId"
                params={{ vaultId, itemId: item.id }}
                style={{ animationDelay: `${Math.min(i, 18) * 28}ms` }}
                className="row-interactive animate-fade-up group flex items-center gap-3.5 border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-accent/50 [&.active]:bg-accent"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white shadow-sm transition-transform duration-200 group-hover:scale-105"
                  style={avatarStyle(item.decryptedName)}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{item.decryptedName}</div>
                  <div className="text-xs text-muted-foreground">
                    {ITEM_TYPE_LABELS[item.itemType] ?? item.itemType}
                  </div>
                </div>
                {item.favorite && (
                  <Star className="h-4 w-4 shrink-0 fill-yellow-500 text-yellow-500" />
                )}
                <ChevronRight className="h-4 w-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS };
