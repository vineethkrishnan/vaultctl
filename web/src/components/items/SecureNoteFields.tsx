// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import type { SecureNoteData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: SecureNoteData;
  onChange: (data: SecureNoteData) => void;
}

export function SecureNoteFields({ data, onChange }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const set = <K extends keyof SecureNoteData>(key: K, value: SecureNoteData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label={t("vault:fields.content")} value={data.content} onChange={(v) => set("content", v)} type="markdown" />
      <Field label={t("vault:fields.notes")} value={data.notes} onChange={(v) => set("notes", v)} type="markdown" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
