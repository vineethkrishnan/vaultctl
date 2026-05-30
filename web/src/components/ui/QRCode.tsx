// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from "react";
import { encodeQR, type ErrorCorrectionLevel } from "@/shared/qr/qr";

interface DrawOptions {
  size?: number;
  level?: ErrorCorrectionLevel;
  quiet?: number;
}

/**
 * Render a QR matrix onto a canvas with a quiet zone. Returns false if the
 * value is too long to encode (caller can fall back to showing text).
 */
export function drawQRToCanvas(
  canvas: HTMLCanvasElement,
  value: string,
  { size = 200, level = "M", quiet = 4 }: DrawOptions = {},
): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  let modules: boolean[][];
  try {
    modules = encodeQR(value, level);
  } catch {
    return false;
  }

  const moduleCount = modules.length;
  const dim = moduleCount + quiet * 2;
  const scale = Math.max(1, Math.floor(size / dim));
  const pixels = dim * scale;

  canvas.width = pixels;
  canvas.height = pixels;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pixels, pixels);
  ctx.fillStyle = "#000000";
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (modules[row]![col]) {
        ctx.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
      }
    }
  }
  return true;
}

interface QRCodeProps {
  value: string;
  size?: number;
  level?: ErrorCorrectionLevel;
  className?: string;
}

export function QRCode({ value, size = 200, level = "M", className }: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) drawQRToCanvas(canvasRef.current, value, { size, level });
  }, [value, size, level]);
  return <canvas ref={canvasRef} className={className} />;
}
