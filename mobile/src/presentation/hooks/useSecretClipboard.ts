// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useCallback, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';

const WIPE_DELAY_MS = 30_000;

export function useSecretClipboard() {
  const [copied, setCopied] = useState(false);
  const wipeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (wipeTimer.current) clearTimeout(wipeTimer.current);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const copy = useCallback(async (value: string, secret: boolean) => {
    if (wipeTimer.current) {
      clearTimeout(wipeTimer.current);
      wipeTimer.current = null;
    }
    if (copiedTimer.current) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }

    await Clipboard.setStringAsync(value);
    setCopied(true);

    copiedTimer.current = setTimeout(() => setCopied(false), 2000);

    if (secret) {
      wipeTimer.current = setTimeout(() => {
        Clipboard.setStringAsync('');
      }, WIPE_DELAY_MS);
    }
  }, []);

  return { copy, copied };
}
