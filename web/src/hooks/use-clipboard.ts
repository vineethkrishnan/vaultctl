import { useCallback, useRef } from "react";

const DEFAULT_CLEAR_MS = 30_000;

export function useClipboard(clearAfterMs = DEFAULT_CLEAR_MS) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = useCallback(
    async (text: string) => {
      await navigator.clipboard.writeText(text);

      if (timerRef.current) clearTimeout(timerRef.current);
      if (clearAfterMs > 0) {
        timerRef.current = setTimeout(() => {
          navigator.clipboard.writeText("").catch(() => {});
        }, clearAfterMs);
      }
    },
    [clearAfterMs],
  );

  return { copy };
}
