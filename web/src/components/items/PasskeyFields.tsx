// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import type { PasskeyData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: PasskeyData;
  onChange: (data: PasskeyData) => void;
}

// Everything except notes and custom fields is read-only: the relying party
// owns these values, and editing one would break the credential rather than
// rename it. data.privateKey is deliberately absent - it is the credential
// itself and is never rendered, masked or otherwise.
export function PasskeyFields({ data, onChange }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const set = <K extends keyof PasskeyData>(key: K, value: PasskeyData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label={t("vault:fields.rpId")} value={data.rpId} onChange={(v) => set("rpId", v)} readOnly />
      <Field label={t("vault:fields.rpName")} value={data.rpName} onChange={(v) => set("rpName", v)} readOnly />
      <Field label={t("vault:fields.userName")} value={data.userName} onChange={(v) => set("userName", v)} readOnly copyable />
      <Field label={t("vault:fields.userDisplayName")} value={data.userDisplayName} onChange={(v) => set("userDisplayName", v)} readOnly />
      <Field label={t("vault:fields.credentialId")} value={data.credentialId} onChange={(v) => set("credentialId", v)} readOnly copyable />
      <Field label={t("vault:fields.userHandle")} value={data.userHandle} onChange={(v) => set("userHandle", v)} readOnly />
      {data.createdAt && (
        <Field
          label={t("vault:fields.passkeyCreatedAt")}
          value={formatDate(data.createdAt)}
          onChange={() => {}}
          readOnly
        />
      )}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="discoverable"
          checked={data.discoverable}
          onChange={(e) => set("discoverable", e.target.checked)}
          className="rounded"
          disabled
        />
        <label htmlFor="discoverable" className="text-sm">
          {t("vault:fields.discoverable")}
        </label>
      </div>
      <Field label={t("vault:fields.notes")} value={data.notes} onChange={(v) => set("notes", v)} type="markdown" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
