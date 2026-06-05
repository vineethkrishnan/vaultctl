// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, apiDelete } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { decryptData, decryptName, encryptData, encryptName } from "@/lib/key-holder";
import { ITEM_TYPE_LABELS } from "@/components/vault/ItemList";
import { RepromptDialog } from "@/components/vault/RepromptDialog";
import { LoginFields } from "@/components/items/LoginFields";
import { SecureNoteFields } from "@/components/items/SecureNoteFields";
import { CreditCardFields } from "@/components/items/CreditCardFields";
import { IdentityFields } from "@/components/items/IdentityFields";
import { ApiKeyFields } from "@/components/items/ApiKeyFields";
import { SSHKeyFields } from "@/components/items/SSHKeyFields";
import { PasskeyFields } from "@/components/items/PasskeyFields";
import { AttachmentsSection } from "@/components/items/AttachmentsSection";
import { itemDataSchemas } from "@/shared/types/item-data";
import type { ItemResponse } from "@/shared/types/api";
import { ArrowLeft, Star, Trash2 } from "lucide-react";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Props {
  vaultId: string;
  itemId: string;
}

export function ItemEditor({ vaultId, itemId }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: item, isLoading } = useQuery({
    queryKey: queryKeys.items.detail(vaultId, itemId),
    queryFn: () =>
      apiGet<ItemResponse>(`/api/v1/vaults/${vaultId}/items/${itemId}`),
  });

  const [name, setName] = useState("");
  const [itemData, setItemData] = useState<Record<string, unknown>>({});
  const [favorite, setFavorite] = useState(false);
  const [decrypted, setDecrypted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [repromptPending, setRepromptPending] = useState(false);

  // Decrypt item on load - gate on reprompt
  useEffect(() => {
    if (!item) return;

    // Always decrypt the name (visible in list anyway)
    let cancelled = false;
    async function decryptNameOnly() {
      try {
        const decName = await decryptName(vaultId, item!.encryptedName);
        if (!cancelled) {
          setName(decName);
          setFavorite(item!.favorite);
        }
      } catch {
        if (!cancelled) setName("[decryption failed]");
      }

      // If reprompt, wait for password confirmation before decrypting data
      if (item!.reprompt) {
        if (!cancelled) setRepromptPending(true);
      } else {
        await decryptFull(cancelled);
      }
    }

    async function decryptFull(isCancelled: boolean) {
      try {
        const dataBytes = await decryptData(vaultId, item!.encryptedData);
        const raw = JSON.parse(decoder.decode(dataBytes));
        const schema = itemDataSchemas[item!.itemType];
        const parsed = schema ? schema.parse(raw) : raw;
        if (!isCancelled) {
          setItemData(parsed as Record<string, unknown>);
          setDecrypted(true);
        }
      } catch {
        if (!isCancelled) {
          setDecrypted(true);
        }
      }
    }

    decryptNameOnly();
    return () => { cancelled = true; };
  }, [item, vaultId]);

  async function handleRepromptConfirm() {
    setRepromptPending(false);
    if (!item) return;
    try {
      const dataBytes = await decryptData(vaultId, item.encryptedData);
      const raw = JSON.parse(decoder.decode(dataBytes));
      const schema = itemDataSchemas[item.itemType];
      const parsed = schema ? schema.parse(raw) : raw;
      setItemData(parsed as Record<string, unknown>);
      setDecrypted(true);
    } catch {
      setDecrypted(true);
    }
  }

  const updateMutation = useMutation({
    mutationFn: async () => {
      const encData = await encryptData(
        vaultId,
        encoder.encode(JSON.stringify(itemData)),
      );
      const encName = await encryptName(vaultId, name);
      return apiPut(`/api/v1/vaults/${vaultId}/items/${itemId}`, {
        encryptedData: encData,
        encryptedName: encName,
        favorite,
        reprompt: item?.reprompt ?? false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all(vaultId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.items.detail(vaultId, itemId),
      });
    },
  });

  const trashMutation = useMutation({
    mutationFn: () =>
      apiDelete(`/api/v1/vaults/${vaultId}/items/${itemId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all(vaultId) });
      navigate({ to: "/vault/$vaultId", params: { vaultId } });
    },
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateMutation.mutateAsync();
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || (!decrypted && !repromptPending)) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <>
    <RepromptDialog
      open={repromptPending}
      onConfirm={handleRepromptConfirm}
      onCancel={() =>
        navigate({ to: "/vault/$vaultId", params: { vaultId } })
      }
    />
    <form onSubmit={handleSave} className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/vault/$vaultId", params: { vaultId } })}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-transparent text-xl font-bold outline-none placeholder:text-muted-foreground"
            placeholder="Item name"
          />
          <span className="text-xs text-muted-foreground">
            {ITEM_TYPE_LABELS[item?.itemType ?? ""] ?? item?.itemType}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setFavorite(!favorite)}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
          title={favorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star
            className={`h-5 w-5 ${favorite ? "fill-yellow-500 text-yellow-500" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={() => trashMutation.mutate()}
          className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
          title="Move to trash"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      {/* Type-specific fields */}
      <div className="rounded-lg border border-border p-4">
        <TypeFields
          itemType={item?.itemType ?? "login"}
          data={itemData}
          onChange={setItemData}
        />
      </div>

      {decrypted && <AttachmentsSection vaultId={vaultId} itemId={itemId} />}

      {/* Save */}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {updateMutation.isSuccess && (
          <span className="self-center text-sm text-muted-foreground">
            Saved
          </span>
        )}
        {updateMutation.isError && (
          <span className="self-center text-sm text-destructive">
            Save failed
          </span>
        )}
      </div>
    </form>
    </>
  );
}

function TypeFields({
  itemType,
  data,
  onChange,
}: {
  itemType: string;
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
}) {
  // Cast through unknown to the specific type - the schema parser guarantees shape
  switch (itemType) {
    case "login":
      return <LoginFields data={data as never} onChange={onChange as never} />;
    case "secure_note":
      return <SecureNoteFields data={data as never} onChange={onChange as never} />;
    case "credit_card":
      return <CreditCardFields data={data as never} onChange={onChange as never} />;
    case "identity":
      return <IdentityFields data={data as never} onChange={onChange as never} />;
    case "api_key":
      return <ApiKeyFields data={data as never} onChange={onChange as never} />;
    case "ssh_key":
      return <SSHKeyFields data={data as never} onChange={onChange as never} />;
    case "passkey":
      return <PasskeyFields data={data as never} onChange={onChange as never} />;
    default:
      return (
        <p className="text-sm text-muted-foreground">
          Unknown item type: {itemType}
        </p>
      );
  }
}
