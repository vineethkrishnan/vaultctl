// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, ShieldAlert } from "lucide-react";
import { useClipboard } from "@/hooks/use-clipboard";
import {
  generateTotp,
  parseTotp,
  secondsRemaining,
  type TotpParams,
} from "@/shared/totp/totp";

interface Props {
  label: string;
  value: string;
}

/**
 * Live RFC 6238 code for a login's stored TOTP secret. The secret is parsed and
 * the code generated entirely in the browser via WebCrypto - nothing about it is
 * ever sent to the server.
 */
export function TotpField({ label, value }: Props) {
  const { t } = useTranslation(["vault", "common"]);
  const { copy } = useClipboard();
  const [copied, setCopied] = useState(false);

  const [params, setParams] = useState<TotpParams | null>(null);
  const [parseError, setParseError] = useState(false);
  const [code, setCode] = useState("");
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    try {
      setParams(parseTotp(value));
      setParseError(false);
    } catch {
      setParams(null);
      setParseError(true);
    }
  }, [value]);

  useEffect(() => {
    if (!params) return;
    let cancelled = false;

    async function refresh() {
      const next = await generateTotp(params!);
      if (cancelled) return;
      setCode(next);
      setRemaining(secondsRemaining(params!.period));
    }

    refresh();
    const interval = window.setInterval(refresh, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [params]);

  function handleCopy() {
    void copy(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  }

  const grouped =
    code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
  const fraction = params ? remaining / params.period : 0;

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {parseError ? (
        <div className="flex items-center gap-2 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{t("vault:totp.invalid")}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
          <span className="font-mono text-lg tracking-wider tabular-nums">
            {grouped || "------"}
          </span>
          <div
            className="relative ml-1 h-6 w-6 shrink-0"
            aria-hidden="true"
            title={t("vault:totp.expiresIn", { seconds: remaining })}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90">
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                strokeWidth="3"
                className="stroke-muted"
              />
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                className={remaining <= 5 ? "stroke-destructive" : "stroke-brand"}
                strokeDasharray={2 * Math.PI * 9}
                strokeDashoffset={2 * Math.PI * 9 * (1 - fraction)}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium tabular-nums text-muted-foreground">
              {remaining}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!code}
            aria-label={t("vault:totp.copy")}
            title={t("vault:totp.copy")}
            className="ml-auto shrink-0 rounded-md border border-input p-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {copied ? (
              <Check className="h-4 w-4 text-brand" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}
