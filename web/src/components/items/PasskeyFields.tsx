// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PasskeyData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: PasskeyData;
  onChange: (data: PasskeyData) => void;
}

export function PasskeyFields({ data, onChange }: Props) {
  const set = <K extends keyof PasskeyData>(key: K, value: PasskeyData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label="Relying Party ID" value={data.rpId} onChange={(v) => set("rpId", v)} readOnly />
      <Field label="Relying Party Name" value={data.rpName} onChange={(v) => set("rpName", v)} readOnly />
      <Field label="Credential ID" value={data.credentialId} onChange={(v) => set("credentialId", v)} readOnly copyable />
      <Field label="User Handle" value={data.userHandle} onChange={(v) => set("userHandle", v)} readOnly />
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
          Discoverable credential
        </label>
      </div>
      <Field label="Notes" value={data.notes} onChange={(v) => set("notes", v)} type="textarea" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
