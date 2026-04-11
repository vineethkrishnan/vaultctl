import type { SSHKeyData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: SSHKeyData;
  onChange: (data: SSHKeyData) => void;
}

export function SSHKeyFields({ data, onChange }: Props) {
  const set = <K extends keyof SSHKeyData>(key: K, value: SSHKeyData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label="Public Key" value={data.publicKey} onChange={(v) => set("publicKey", v)} type="textarea" copyable />
      <Field label="Private Key" value={data.privateKey} onChange={(v) => set("privateKey", v)} type="password" copyable />
      <Field label="Passphrase" value={data.passphrase} onChange={(v) => set("passphrase", v)} type="password" copyable />
      <Field label="Key Type" value={data.keyType} onChange={(v) => set("keyType", v)} placeholder="ED25519, RSA..." />
      <Field label="Fingerprint" value={data.fingerprint} onChange={(v) => set("fingerprint", v)} readOnly copyable />
      <Field label="Host" value={data.host} onChange={(v) => set("host", v)} />
      <Field label="Notes" value={data.notes} onChange={(v) => set("notes", v)} type="textarea" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
