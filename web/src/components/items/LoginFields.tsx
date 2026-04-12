import { useState } from "react";
import type { LoginData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { PasswordGenerator } from "@/components/vault/PasswordGenerator";
import { Wand2 } from "lucide-react";

interface Props {
  data: LoginData;
  onChange: (data: LoginData) => void;
}

export function LoginFields({ data, onChange }: Props) {
  const [showGenerator, setShowGenerator] = useState(false);

  const set = <K extends keyof LoginData>(key: K, value: LoginData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label="Username" value={data.username} onChange={(v) => set("username", v)} copyable />
      <Field label="Password" value={data.password} onChange={(v) => set("password", v)} type="password" copyable />
      <button
        type="button"
        onClick={() => setShowGenerator(!showGenerator)}
        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        <Wand2 className="h-3 w-3" />
        {showGenerator ? "Hide generator" : "Generate password"}
      </button>
      {showGenerator && (
        <PasswordGenerator
          onSelect={(pw) => {
            set("password", pw);
            setShowGenerator(false);
          }}
        />
      )}
      <Field label="URI" value={data.uri} onChange={(v) => set("uri", v)} type="url" copyable />
      <Field label="TOTP Secret" value={data.totp} onChange={(v) => set("totp", v)} type="password" />
      <Field label="Notes" value={data.notes} onChange={(v) => set("notes", v)} type="textarea" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
    </div>
  );
}
