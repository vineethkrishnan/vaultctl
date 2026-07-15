// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutEffect, type RefObject } from "react";

const MAX_HEIGHT_PX = 320;

export function useAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [ref, value]);
}
