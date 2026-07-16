// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import type { GPGKeyData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: GPGKeyData;
  onChange: (data: GPGKeyData) => void;
}

export function GPGKeyFields({ data, onChange }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const set = <K extends keyof GPGKeyData>(key: K, value: GPGKeyData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label={t("vault:fields.uid")} value={data.uid} onChange={(v) => set("uid", v)} placeholder={t("vault:fields.uidPlaceholder")} copyable />
      <Field label={t("vault:fields.keyId")} value={data.keyId} onChange={(v) => set("keyId", v)} placeholder={t("vault:fields.keyIdPlaceholder")} copyable />
      <Field label={t("vault:fields.fingerprint")} value={data.fingerprint} onChange={(v) => set("fingerprint", v)} copyable />
      <Field label={t("vault:fields.keyType")} value={data.keyType} onChange={(v) => set("keyType", v)} placeholder={t("vault:fields.gpgKeyTypePlaceholder")} />
      <Field label={t("vault:fields.expiresAt")} value={data.expiresAt} onChange={(v) => set("expiresAt", v)} placeholder={t("vault:fields.gpgExpiresPlaceholder")} />
      <Field label={t("vault:fields.publicKey")} value={data.publicKey} onChange={(v) => set("publicKey", v)} type="textarea" copyable />
      <Field label={t("vault:fields.privateKey")} value={data.privateKey} onChange={(v) => set("privateKey", v)} type="secret-textarea" copyable />
      <Field label={t("vault:fields.passphrase")} value={data.passphrase} onChange={(v) => set("passphrase", v)} type="password" copyable />
      <Field label={t("vault:fields.notes")} value={data.notes} onChange={(v) => set("notes", v)} type="markdown" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
