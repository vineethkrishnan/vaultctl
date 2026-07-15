// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";
import { encryptData, encryptName } from "@/lib/key-holder";
import { ITEM_TYPE_ICONS } from "@/components/vault/ItemList";
import { LoginFields } from "@/components/items/LoginFields";
import { SecureNoteFields } from "@/components/items/SecureNoteFields";
import { CreditCardFields } from "@/components/items/CreditCardFields";
import { IdentityFields } from "@/components/items/IdentityFields";
import { ApiKeyFields } from "@/components/items/ApiKeyFields";
import { SSHKeyFields } from "@/components/items/SSHKeyFields";
import { PasskeyFields } from "@/components/items/PasskeyFields";
import { PendingAttachments } from "@/components/items/PendingAttachments";
import { useServerFeatures } from "@/hooks/use-server-features";
import { uploadAttachment } from "@/lib/attachments";
import { itemDataSchemas, type ItemData } from "@/shared/types/item-data";
import { ITEM_TYPES, type ItemType, type ItemResponse } from "@/shared/types/api";
import { ArrowLeft } from "lucide-react";

const encoder = new TextEncoder();

const DEFAULT_DATA: Record<ItemType, () => ItemData> = {
  login: () => itemDataSchemas.login!.parse({}),
  secure_note: () => itemDataSchemas.secure_note!.parse({}),
  credit_card: () => itemDataSchemas.credit_card!.parse({}),
  identity: () => itemDataSchemas.identity!.parse({}),
  api_key: () => itemDataSchemas.api_key!.parse({}),
  ssh_key: () => itemDataSchemas.ssh_key!.parse({}),
  passkey: () => itemDataSchemas.passkey!.parse({}),
};

export function VaultNewItemPage() {
  const { t } = useTranslation(["vault", "common"]);
  const { vaultId } = useParams({ strict: false }) as { vaultId: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const features = useServerFeatures();
  const [selectedType, setSelectedType] = useState<ItemType | null>(null);
  const [name, setName] = useState("");
  const [itemData, setItemData] = useState<Record<string, unknown>>({});
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  function selectType(type: ItemType) {
    setSelectedType(type);
    setItemData(DEFAULT_DATA[type]() as Record<string, unknown>);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const encData = await encryptData(
        vaultId,
        encoder.encode(JSON.stringify(itemData)),
      );
      const encName = await encryptName(vaultId, name || t("vault:newItem.untitled"));
      const item = await apiPost<ItemResponse>(`/api/v1/vaults/${vaultId}/items`, {
        itemType: selectedType,
        encryptedData: encData,
        encryptedName: encName,
        favorite: false,
        reprompt: false,
      });

      // The item now exists. A failed upload must not bubble as a create
      // failure, or retrying the form would create a duplicate item.
      const failed: string[] = [];
      for (const file of pendingFiles) {
        try {
          await uploadAttachment(vaultId, item.id, file);
        } catch {
          failed.push(file.name);
        }
      }
      return { item, failed };
    },
    onSuccess: ({ item, failed }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all(vaultId) });
      if (failed.length > 0) {
        // Send them to the item so the attachments can be retried there.
        navigate({
          to: "/vault/$vaultId/items/$itemId",
          params: { vaultId, itemId: item.id },
        });
        return;
      }
      navigate({ to: "/vault/$vaultId", params: { vaultId } });
    },
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createMutation.mutateAsync();
    } finally {
      setSaving(false);
    }
  }

  // Type selector
  if (!selectedType) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              navigate({ to: "/vault/$vaultId", params: { vaultId } })
            }
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold">{t("vault:newItem.title")}</h1>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          {t("vault:newItem.chooseType")}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ITEM_TYPES.map((type) => {
            const Icon = ITEM_TYPE_ICONS[type]!;
            return (
              <button
                key={type}
                onClick={() => selectType(type)}
                className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 hover:bg-accent/50"
              >
                <Icon className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {t(`vault:itemTypes.${type}`)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Item form
  return (
    <div className="mx-auto max-w-2xl">
      <form onSubmit={handleSave} className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSelectedType(null)}
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
              placeholder={t("vault:newItem.namePlaceholder")}
              autoFocus
            />
            <span className="text-xs text-muted-foreground">
              {t("vault:newItem.newOfType", { type: t(`vault:itemTypes.${selectedType}`) })}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <TypeFields
            itemType={selectedType}
            data={itemData}
            onChange={setItemData}
          />
        </div>

        {features.attachments && (
          <PendingAttachments
            files={pendingFiles}
            onChange={setPendingFiles}
            disabled={saving || createMutation.isPending}
          />
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving || createMutation.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving || createMutation.isPending
              ? t("vault:newItem.creating")
              : t("vault:newItem.create")}
          </button>
          {createMutation.isError && (
            <span className="self-center text-sm text-destructive">
              {t("vault:newItem.createFailed")}
            </span>
          )}
        </div>
      </form>
    </div>
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
      return null;
  }
}
