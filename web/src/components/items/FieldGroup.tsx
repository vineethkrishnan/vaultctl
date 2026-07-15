// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Copy } from "lucide-react";
import { useClipboard } from "@/hooks/use-clipboard";
import { useAutoResize } from "@/hooks/use-auto-resize";
import { MarkdownEditor } from "./MarkdownEditor";

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?:
    | "text"
    | "password"
    | "email"
    | "url"
    | "textarea"
    | "secret-textarea"
    | "markdown";
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSecret = type === "password" || type === "secret-textarea";
  const isTextarea = type === "textarea" || type === "secret-textarea";
  const inputId = useId();

  useAutoResize(textareaRef, isTextarea ? value : "");

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-foreground"
      >
        {label}
      </label>
      <div className="flex items-start gap-1">
        {type === "markdown" ? (
          <MarkdownEditor
            id={inputId}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            readOnly={readOnly}
          />
        ) : isTextarea ? (
          <textarea
            id={inputId}
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
            rows={2}
            className={`max-h-80 w-full resize-y overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2 ${
              type === "secret-textarea" ? "font-mono" : ""
            } ${
              type === "secret-textarea" && !revealed
                ? "[-webkit-text-security:disc]"
                : ""
            }`}
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
