// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { Fingerprint, Copy } from "lucide-react";
import { useClipboard } from "@/hooks/use-clipboard";
import { fromBase64, sha256 } from "@/shared/crypto";

interface Props {
  identityPublicKey: string; // base64
  label?: string;
}

/**
 * Derives a 60-digit numeric safety number from an Ed25519 identity public key.
 *
 * Algorithm: SHA-256(raw_public_key_bytes) → take first 30 bytes → each byte
 * maps to two decimal digits (byte % 100, zero-padded) → 60 digits total.
 * Displayed in groups of 5 for readability (C1).
 */
async function deriveSafetyNumber(publicKeyB64: string): Promise<string> {
  const hash = await sha256(fromBase64(publicKeyB64));

  // Take first 30 bytes → 60 digits
  let digits = "";
  for (let i = 0; i < 30; i++) {
    digits += String(hash[i]! % 100).padStart(2, "0");
  }

  // Group into blocks of 5
  return digits.match(/.{1,5}/g)!.join(" ");
}

export function SafetyNumber({ identityPublicKey, label }: Props) {
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const { copy } = useClipboard(0); // no auto-clear for safety numbers

  useEffect(() => {
    if (!identityPublicKey) return;
    deriveSafetyNumber(identityPublicKey).then(setSafetyNumber);
  }, [identityPublicKey]);

  if (!safetyNumber) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Fingerprint className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          {label ?? "Safety Number"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Verify this number out-of-band to confirm identity key authenticity.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-xs tracking-wider select-all">
          {safetyNumber}
        </code>
        <button
          onClick={() => copy(safetyNumber.replace(/ /g, ""))}
          className="shrink-0 rounded-md border border-input p-2 text-muted-foreground hover:text-foreground"
          title="Copy"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
