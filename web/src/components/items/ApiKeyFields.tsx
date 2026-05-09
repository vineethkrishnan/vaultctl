// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ApiKeyData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: ApiKeyData;
  onChange: (data: ApiKeyData) => void;
}

export function ApiKeyFields({ data, onChange }: Props) {
  const set = <K extends keyof ApiKeyData>(key: K, value: ApiKeyData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label="API Key" value={data.key} onChange={(v) => set("key", v)} type="password" copyable />
      <Field label="Environment" value={data.environment} onChange={(v) => set("environment", v)} placeholder="production, staging..." />
      <Field label="Service URL" value={data.serviceUrl} onChange={(v) => set("serviceUrl", v)} type="url" />
      <Field label="Expires At" value={data.expiresAt} onChange={(v) => set("expiresAt", v)} placeholder="YYYY-MM-DD" />
      <Field label="Notes" value={data.notes} onChange={(v) => set("notes", v)} type="textarea" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
