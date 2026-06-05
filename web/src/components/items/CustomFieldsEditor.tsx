// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Eye, EyeOff, Copy } from "lucide-react";
import { useClipboard } from "@/hooks/use-clipboard";
import type { CustomField } from "@/shared/types/item-data";

/**
 * Custom fields editor - M7 polish.
 *
 * Every item type's zod schema already carries a `customFields: CustomField[]`
 * array (see shared/types/item-data.ts). Until now no UI rendered it. This
 * component is dropped into every *Fields.tsx component as a section below
 * the type-specific fields.
 *
 * Supported kinds match the schema's `type` enum:
 *   - text     - plain text, always visible
 *   - hidden   - masked like a password field with reveal + copy
 *   - boolean  - checkbox
 *   - url      - text that renders as a link in read mode (we're in edit
 *                mode here so just a plain input with a copy button)
 */

interface Props {
  fields: CustomField[];
  onChange: (fields: CustomField[]) => void;
}

export function CustomFieldsEditor({ fields, onChange }: Props) {
  const { t } = useTranslation(["vault", "common"]);

  function addField() {
    onChange([...fields, { name: "", value: "", type: "text" }]);
  }

  function updateField(index: number, patch: Partial<CustomField>) {
    onChange(
      fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  }

  function removeField(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">
          {t("vault:customFields.heading")}
        </label>
        <button
          type="button"
          onClick={addField}
          className="flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          {t("vault:customFields.addField")}
        </button>
      </div>

      {fields.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("vault:customFields.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {fields.map((field, i) => (
            <li key={i}>
              <CustomFieldRow
                field={field}
                onChange={(patch) => updateField(i, patch)}
                onRemove={() => removeField(i)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CustomFieldRow({
  field,
  onChange,
  onRemove,
}: {
  field: CustomField;
  onChange: (patch: Partial<CustomField>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation(["vault", "common"]);
  const [revealed, setRevealed] = useState(false);
  const { copy } = useClipboard();

  return (
    <div className="flex flex-wrap gap-2 rounded-md border border-border p-2">
      <input
        type="text"
        value={field.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder={t("vault:customFields.namePlaceholder")}
        className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none ring-ring focus:ring-2"
      />
      <select
        value={field.type}
        onChange={(e) =>
          onChange({ type: e.target.value as CustomField["type"] })
        }
        className="rounded-md border border-input bg-background px-2 py-1 text-sm outline-none"
        title={t("vault:customFields.fieldType")}
      >
        <option value="text">{t("vault:customFields.typeText")}</option>
        <option value="hidden">{t("vault:customFields.typeHidden")}</option>
        <option value="boolean">{t("vault:customFields.typeBoolean")}</option>
        <option value="url">{t("vault:customFields.typeUrl")}</option>
      </select>
      {field.type === "boolean" ? (
        <label className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={field.value === "true"}
            onChange={(e) =>
              onChange({ value: e.target.checked ? "true" : "false" })
            }
          />
          {field.value === "true" ? t("vault:customFields.yes") : t("vault:customFields.no")}
        </label>
      ) : (
        <input
          type={field.type === "hidden" && !revealed ? "password" : "text"}
          value={field.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={t("vault:customFields.valuePlaceholder")}
          className="min-w-0 flex-[2] rounded-md border border-input bg-background px-2 py-1 text-sm outline-none ring-ring focus:ring-2"
        />
      )}
      {field.type === "hidden" && (
        <button
          type="button"
          onClick={() => setRevealed(!revealed)}
          className="rounded-md border border-input p-1.5 text-muted-foreground hover:text-foreground"
          title={revealed ? t("vault:fields.hide") : t("vault:fields.reveal")}
        >
          {revealed ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      {(field.type === "text" ||
        field.type === "hidden" ||
        field.type === "url") &&
        field.value && (
          <button
            type="button"
            onClick={() => copy(field.value)}
            className="rounded-md border border-input p-1.5 text-muted-foreground hover:text-foreground"
            title={t("vault:fields.copy")}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-md border border-input p-1.5 text-muted-foreground hover:text-destructive"
        title={t("vault:fields.remove")}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
