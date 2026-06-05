// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import type { SSHKeyData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: SSHKeyData;
  onChange: (data: SSHKeyData) => void;
}

export function SSHKeyFields({ data, onChange }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const set = <K extends keyof SSHKeyData>(key: K, value: SSHKeyData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label={t("vault:fields.publicKey")} value={data.publicKey} onChange={(v) => set("publicKey", v)} type="textarea" copyable />
      <Field label={t("vault:fields.privateKey")} value={data.privateKey} onChange={(v) => set("privateKey", v)} type="password" copyable />
      <Field label={t("vault:fields.passphrase")} value={data.passphrase} onChange={(v) => set("passphrase", v)} type="password" copyable />
      <Field label={t("vault:fields.keyType")} value={data.keyType} onChange={(v) => set("keyType", v)} placeholder={t("vault:fields.keyTypePlaceholder")} />
      <Field label={t("vault:fields.fingerprint")} value={data.fingerprint} onChange={(v) => set("fingerprint", v)} readOnly copyable />
      <Field label={t("vault:fields.host")} value={data.host} onChange={(v) => set("host", v)} />
      <Field label={t("vault:fields.notes")} value={data.notes} onChange={(v) => set("notes", v)} type="textarea" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
