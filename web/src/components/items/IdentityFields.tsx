// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import type { IdentityData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: IdentityData;
  onChange: (data: IdentityData) => void;
}

export function IdentityFields({ data, onChange }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const set = <K extends keyof IdentityData>(key: K, value: IdentityData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("vault:fields.firstName")} value={data.firstName} onChange={(v) => set("firstName", v)} />
        <Field label={t("vault:fields.lastName")} value={data.lastName} onChange={(v) => set("lastName", v)} />
      </div>
      <Field label={t("vault:fields.email")} value={data.email} onChange={(v) => set("email", v)} type="email" copyable />
      <Field label={t("vault:fields.phone")} value={data.phone} onChange={(v) => set("phone", v)} copyable />
      <Field label={t("vault:fields.address")} value={data.address} onChange={(v) => set("address", v)} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={t("vault:fields.city")} value={data.city} onChange={(v) => set("city", v)} />
        <Field label={t("vault:fields.state")} value={data.state} onChange={(v) => set("state", v)} />
        <Field label={t("vault:fields.postalCode")} value={data.postalCode} onChange={(v) => set("postalCode", v)} />
      </div>
      <Field label={t("vault:fields.country")} value={data.country} onChange={(v) => set("country", v)} />
      <Field label={t("vault:fields.ssn")} value={data.ssn} onChange={(v) => set("ssn", v)} type="password" copyable />
      <Field label={t("vault:fields.passportNumber")} value={data.passportNumber} onChange={(v) => set("passportNumber", v)} type="password" />
      <Field label={t("vault:fields.licenseNumber")} value={data.licenseNumber} onChange={(v) => set("licenseNumber", v)} />
      <Field label={t("vault:fields.notes")} value={data.notes} onChange={(v) => set("notes", v)} type="markdown" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
