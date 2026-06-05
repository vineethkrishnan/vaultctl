// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import type { ApiKeyData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: ApiKeyData;
  onChange: (data: ApiKeyData) => void;
}

export function ApiKeyFields({ data, onChange }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const set = <K extends keyof ApiKeyData>(key: K, value: ApiKeyData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label={t("vault:fields.apiKey")} value={data.key} onChange={(v) => set("key", v)} type="password" copyable />
      <Field label={t("vault:fields.environment")} value={data.environment} onChange={(v) => set("environment", v)} placeholder={t("vault:fields.environmentPlaceholder")} />
      <Field label={t("vault:fields.serviceUrl")} value={data.serviceUrl} onChange={(v) => set("serviceUrl", v)} type="url" />
      <Field label={t("vault:fields.expiresAt")} value={data.expiresAt} onChange={(v) => set("expiresAt", v)} placeholder={t("vault:fields.expiresAtPlaceholder")} />
      <Field label={t("vault:fields.notes")} value={data.notes} onChange={(v) => set("notes", v)} type="textarea" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
