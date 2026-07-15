// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import type { CreditCardData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: CreditCardData;
  onChange: (data: CreditCardData) => void;
}

export function CreditCardFields({ data, onChange }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const set = <K extends keyof CreditCardData>(key: K, value: CreditCardData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label={t("vault:fields.cardholderName")} value={data.cardholderName} onChange={(v) => set("cardholderName", v)} />
      <Field label={t("vault:fields.cardNumber")} value={data.number} onChange={(v) => set("number", v)} type="password" copyable />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("vault:fields.expiry")} value={data.expiry} onChange={(v) => set("expiry", v)} placeholder={t("vault:fields.expiryPlaceholder")} />
        <Field label={t("vault:fields.cvv")} value={data.cvv} onChange={(v) => set("cvv", v)} type="password" copyable />
      </div>
      <Field label={t("vault:fields.cardType")} value={data.cardType} onChange={(v) => set("cardType", v)} placeholder={t("vault:fields.cardTypePlaceholder")} />
      <Field label={t("vault:fields.notes")} value={data.notes} onChange={(v) => set("notes", v)} type="markdown" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
