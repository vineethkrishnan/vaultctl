// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
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
  const [revealed, setRevealed] = useState(false);
  const { copy } = useClipboard();
  const isSecret = type === "password";

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="flex gap-1">
        {type === "textarea" ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
          />
        ) : (
          <input
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
            className="shrink-0 rounded-md border border-input p-2 text-muted-foreground hover:text-foreground"
            title={revealed ? "Hide" : "Reveal"}
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
            onClick={() => copy(value)}
            className="shrink-0 rounded-md border border-input p-2 text-muted-foreground hover:text-foreground"
            title="Copy"
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
