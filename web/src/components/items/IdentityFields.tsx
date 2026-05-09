// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IdentityData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

interface Props {
  data: IdentityData;
  onChange: (data: IdentityData) => void;
}

export function IdentityFields({ data, onChange }: Props) {
  const set = <K extends keyof IdentityData>(key: K, value: IdentityData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="First Name" value={data.firstName} onChange={(v) => set("firstName", v)} />
        <Field label="Last Name" value={data.lastName} onChange={(v) => set("lastName", v)} />
      </div>
      <Field label="Email" value={data.email} onChange={(v) => set("email", v)} type="email" copyable />
      <Field label="Phone" value={data.phone} onChange={(v) => set("phone", v)} copyable />
      <Field label="Address" value={data.address} onChange={(v) => set("address", v)} />
      <div className="grid grid-cols-3 gap-4">
        <Field label="City" value={data.city} onChange={(v) => set("city", v)} />
        <Field label="State" value={data.state} onChange={(v) => set("state", v)} />
        <Field label="Postal Code" value={data.postalCode} onChange={(v) => set("postalCode", v)} />
      </div>
      <Field label="Country" value={data.country} onChange={(v) => set("country", v)} />
      <Field label="SSN" value={data.ssn} onChange={(v) => set("ssn", v)} type="password" copyable />
      <Field label="Passport Number" value={data.passportNumber} onChange={(v) => set("passportNumber", v)} type="password" />
      <Field label="License Number" value={data.licenseNumber} onChange={(v) => set("licenseNumber", v)} />
      <Field label="Notes" value={data.notes} onChange={(v) => set("notes", v)} type="textarea" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
