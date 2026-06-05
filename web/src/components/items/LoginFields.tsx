// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LoginData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { PasswordHistory } from "./PasswordHistory";
import { PasswordGenerator } from "@/components/vault/PasswordGenerator";
import { Wand2 } from "lucide-react";

interface Props {
  data: LoginData;
  onChange: (data: LoginData) => void;
}

export function LoginFields({ data, onChange }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const [showGenerator, setShowGenerator] = useState(false);

  const set = <K extends keyof LoginData>(key: K, value: LoginData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label={t("vault:fields.username")} value={data.username} onChange={(v) => set("username", v)} copyable />
      <Field label={t("vault:fields.password")} value={data.password} onChange={(v) => set("password", v)} type="password" copyable />
      <button
        type="button"
        onClick={() => setShowGenerator(!showGenerator)}
        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        <Wand2 className="h-3 w-3" />
        {showGenerator ? t("vault:fields.hideGenerator") : t("vault:fields.generatePassword")}
      </button>
      {showGenerator && (
        <PasswordGenerator
          onSelect={(pw) => {
            set("password", pw);
            setShowGenerator(false);
          }}
        />
      )}
      <Field label={t("vault:fields.uri")} value={data.uri} onChange={(v) => set("uri", v)} type="url" copyable />
      <Field label={t("vault:fields.totp")} value={data.totp} onChange={(v) => set("totp", v)} type="password" />
      <Field label={t("vault:fields.notes")} value={data.notes} onChange={(v) => set("notes", v)} type="textarea" />
      <CustomFieldsEditor
        fields={data.customFields}
        onChange={(customFields) => set("customFields", customFields)}
      />
      <PasswordHistory entries={data.passwordHistory} />
    </div>
  );
}
