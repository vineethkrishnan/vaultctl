// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Copy } from "lucide-react";
import { useClipboard } from "@/hooks/use-clipboard";

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "password" | "email" | "url" | "textarea";
  placeholder?: string;
  readOnly?: boolean;
  copyable?: boolean;
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  readOnly,
  copyable,
}: FieldProps) {
  const { t } = useTranslation(["vault", "common"]);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const { copy } = useClipboard();
  const isSecret = type === "password";
  const inputId = useId();

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-foreground"
      >
        {label}
      </label>
      <div className="flex gap-1">
        {type === "textarea" ? (
          <textarea
            id={inputId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
        ) : (
          <input
            id={inputId}
            type={isSecret && !revealed ? "password" : "text"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
        )}
        {isSecret && (
          <button
            type="button"
            onClick={() => setRevealed(!revealed)}
            aria-pressed={revealed}
            aria-label={revealed ? t("vault:fields.hide") : t("vault:fields.reveal")}
            className="shrink-0 rounded-md border border-input p-2 text-muted-foreground hover:text-foreground"
            title={revealed ? t("vault:fields.hide") : t("vault:fields.reveal")}
          >
            {revealed ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        )}
        {copyable && value && (
          <button
            type="button"
            onClick={() => {
              void copy(value).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              });
            }}
            aria-label={copied ? t("vault:fields.copied") : t("vault:fields.copy")}
            className="shrink-0 rounded-md border border-input p-2 text-muted-foreground hover:text-foreground"
            title={t("vault:fields.copy")}
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? t("vault:fields.copied") : ""}
      </span>
    </div>
  );
}
