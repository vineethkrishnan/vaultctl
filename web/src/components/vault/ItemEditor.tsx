// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, apiDelete } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { decryptData, decryptName, encryptData, encryptName } from "@/lib/key-holder";
import { RepromptDialog } from "@/components/vault/RepromptDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoginFields } from "@/components/items/LoginFields";
import { SecureNoteFields } from "@/components/items/SecureNoteFields";
import { CreditCardFields } from "@/components/items/CreditCardFields";
import { IdentityFields } from "@/components/items/IdentityFields";
import { ApiKeyFields } from "@/components/items/ApiKeyFields";
import { SSHKeyFields } from "@/components/items/SSHKeyFields";
import { PasskeyFields } from "@/components/items/PasskeyFields";
import { AttachmentsSection } from "@/components/items/AttachmentsSection";
import { useServerFeatures } from "@/hooks/use-server-features";
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
  const { t } = useTranslation(["vault", "common"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const features = useServerFeatures();

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
  const [trashPending, setTrashPending] = useState(false);
  // When the name can't be decrypted, the field is locked to an error message:
  // editing + saving would re-encrypt the placeholder and clobber the real name.
  const [nameDecryptFailed, setNameDecryptFailed] = useState(false);

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
        if (!cancelled) {
          setName(t("vault:editor.decryptionFailed"));
          setNameDecryptFailed(true);
        }
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
      navigate({ to: "/vault/$vaultId", params: { vaultId } });
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
    <ConfirmDialog
      open={trashPending}
      title={t("vault:items.trashConfirm.title")}
      message={t("vault:items.trashConfirm.message", { name })}
      confirmLabel={t("vault:items.trashConfirm.confirmLabel")}
      destructive
      busy={trashMutation.isPending}
      onConfirm={() => trashMutation.mutate()}
      onCancel={() => setTrashPending(false)}
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
            readOnly={nameDecryptFailed}
            aria-invalid={nameDecryptFailed}
            className={`w-full bg-transparent text-xl font-bold outline-none placeholder:text-muted-foreground ${
              nameDecryptFailed ? "text-destructive" : ""
            }`}
            placeholder={t("vault:editor.namePlaceholder")}
          />
          <span className="text-xs text-muted-foreground">
            {nameDecryptFailed
              ? t("vault:editor.decryptErrorHint")
              : item?.itemType
                ? t(`vault:itemTypes.${item.itemType}`)
                : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setFavorite(!favorite)}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
          title={favorite ? t("vault:editor.removeFavorite") : t("vault:editor.addFavorite")}
        >
          <Star
            className={`h-5 w-5 ${favorite ? "fill-yellow-500 text-yellow-500" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={() => setTrashPending(true)}
          className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
          title={t("vault:editor.moveToTrash")}
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

      {decrypted && features.attachments && (
        <AttachmentsSection vaultId={vaultId} itemId={itemId} />
      )}

      {/* Save */}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || nameDecryptFailed}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? t("vault:editor.saving") : t("common:actions.save")}
        </button>
        {nameDecryptFailed && (
          <span className="self-center text-sm text-destructive">
            {t("vault:editor.saveDisabledDecryptFailed")}
          </span>
        )}
        {updateMutation.isError && (
          <span className="self-center text-sm text-destructive">
            {t("vault:editor.saveFailed")}
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
  const { t } = useTranslation(["vault", "common"]);
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
          {t("vault:editor.unknownType", { type: itemType })}
        </p>
      );
  }
}
