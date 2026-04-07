import { useEffect, useState } from "react";
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

  if (vaultId === "none") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-muted-foreground">No vaults found.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md bg-muted"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load items
      </div>
    );
  }

  if (!decryptedItems.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg font-medium">No items yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create your first item to get started.
        </p>
        <Link
          to="/vault/$vaultId/items/new"
          params={{ vaultId }}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create Item
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {decryptedItems.map((item) => {
        const Icon = ITEM_TYPE_ICONS[item.itemType] ?? KeyRound;
        return (
          <Link
            key={item.id}
            to="/vault/$vaultId/items/$itemId"
            params={{ vaultId, itemId: item.id }}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent/50 [&.active]:bg-accent"
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {item.decryptedName}
              </div>
              <div className="text-xs text-muted-foreground">
                {ITEM_TYPE_LABELS[item.itemType] ?? item.itemType}
              </div>
            </div>
            {item.favorite && (
              <Star className="h-3.5 w-3.5 shrink-0 fill-yellow-500 text-yellow-500" />
            )}
          </Link>
        );
      })}
    </div>
  );
}

export { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS };
