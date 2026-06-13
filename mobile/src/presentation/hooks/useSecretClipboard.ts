// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';

const WIPE_DELAY_MS = 30_000;

let pendingWipeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWipe() {
  if (pendingWipeTimer) clearTimeout(pendingWipeTimer);
  pendingWipeTimer = setTimeout(async () => {
    pendingWipeTimer = null;
    const current = await Clipboard.getStringAsync().catch(() => '');
    if (current !== '') {
      await Clipboard.setStringAsync('').catch(() => undefined);
    }
  }, WIPE_DELAY_MS);
}

export function useSecretClipboard() {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const copy = useCallback(async (value: string, secret: boolean) => {
    if (copiedTimer.current) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }

    await Clipboard.setStringAsync(value);
    setCopied(true);

    copiedTimer.current = setTimeout(() => setCopied(false), 2000);

    if (secret) scheduleWipe();
  }, []);

  return { copy, copied };
}
