import type { CreditCardData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: CreditCardData;
  onChange: (data: CreditCardData) => void;
}

export function CreditCardFields({ data, onChange }: Props) {
  const set = <K extends keyof CreditCardData>(key: K, value: CreditCardData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label="Cardholder Name" value={data.cardholderName} onChange={(v) => set("cardholderName", v)} />
      <Field label="Card Number" value={data.number} onChange={(v) => set("number", v)} type="password" copyable />
      <div className="grid grid-cols-2 gap-4">
        <Field label="Expiry (MM/YY)" value={data.expiry} onChange={(v) => set("expiry", v)} placeholder="MM/YY" />
        <Field label="CVV" value={data.cvv} onChange={(v) => set("cvv", v)} type="password" copyable />
      </div>
      <Field label="Card Type" value={data.cardType} onChange={(v) => set("cardType", v)} placeholder="Visa, Mastercard..." />
      <Field label="Notes" value={data.notes} onChange={(v) => set("notes", v)} type="textarea" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
