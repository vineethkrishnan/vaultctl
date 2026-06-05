// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Copy } from "lucide-react";
import { useClipboard } from "@/hooks/use-clipboard";

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()_+-=[]{}|;':\",./<>?";

interface Props {
  onSelect?: (password: string) => void;
}

export function PasswordGenerator({ onSelect }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const [length, setLength] = useState(20);
  const [useLower, setUseLower] = useState(true);
  const [useUpper, setUseUpper] = useState(true);
  const [useDigits, setUseDigits] = useState(true);
  const [useSymbols, setUseSymbols] = useState(true);
  const { copy } = useClipboard();

  const generate = useCallback(() => {
    let charset = "";
    if (useLower) charset += LOWER;
    if (useUpper) charset += UPPER;
    if (useDigits) charset += DIGITS;
    if (useSymbols) charset += SYMBOLS;
    if (!charset) charset = LOWER + UPPER + DIGITS;

    const arr = new Uint32Array(length);
    crypto.getRandomValues(arr);
    return Array.from(arr, (v) => charset[v % charset.length]).join("");
  }, [length, useLower, useUpper, useDigits, useSymbols]);

  const [password, setPassword] = useState(() => generate());

  function regenerate() {
    setPassword(generate());
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-muted px-2 py-1 text-sm select-all">
          {password}
        </code>
        <button
          type="button"
          onClick={regenerate}
          className="shrink-0 rounded-md border border-input p-2 text-muted-foreground hover:text-foreground"
          title={t("vault:passwordGenerator.regenerate")}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => copy(password)}
          className="shrink-0 rounded-md border border-input p-2 text-muted-foreground hover:text-foreground"
          title={t("vault:passwordGenerator.copy")}
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>

      {/* Length slider */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground w-16">
          {t("vault:passwordGenerator.length", { count: length })}
        </label>
        <input
          type="range"
          min={8}
          max={128}
          value={length}
          onChange={(e) => {
            setLength(Number(e.target.value));
            setPassword(generate());
          }}
          className="flex-1"
        />
      </div>

      {/* Character set toggles */}
      <div className="flex flex-wrap gap-3 text-sm">
        {[
          { label: "a-z", state: useLower, set: setUseLower },
          { label: "A-Z", state: useUpper, set: setUseUpper },
          { label: "0-9", state: useDigits, set: setUseDigits },
          { label: "!@#", state: useSymbols, set: setUseSymbols },
        ].map(({ label, state, set }) => (
          <label key={label} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={state}
              onChange={(e) => {
                set(e.target.checked);
                setPassword(generate());
              }}
              className="rounded"
            />
            <span className="font-mono text-xs">{label}</span>
          </label>
        ))}
      </div>

      {onSelect && (
        <button
          type="button"
          onClick={() => onSelect(password)}
          className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("vault:passwordGenerator.usePassword")}
        </button>
      )}
    </div>
  );
}
