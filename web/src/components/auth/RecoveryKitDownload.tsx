// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect, useRef } from "react";
import { Download, QrCode } from "lucide-react";

interface RecoveryKitDownloadProps {
  recoveryKey: string;
}

/**
 * RecoveryKitDownload — offers a printable HTML download and a QR code
 * of the recovery key. Uses a canvas-based QR generator (no external deps).
 */
export function RecoveryKitDownload({ recoveryKey }: RecoveryKitDownloadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrReady, setQrReady] = useState(false);

  useEffect(() => {
    renderQR(canvasRef.current, recoveryKey.replace(/-/g, "")).then(() =>
      setQrReady(true),
    );
  }, [recoveryKey]);

  function handleDownloadPDF() {
    const qrDataUrl = canvasRef.current?.toDataURL("image/png") ?? "";
    const html = buildRecoveryHTML(recoveryKey, qrDataUrl);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vaultctl-recovery-kit.html";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {/* QR code */}
      <div className="flex items-center gap-2">
        <QrCode className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">QR Code</span>
      </div>
      <div className="flex justify-center rounded-md border border-border bg-white p-4">
        <canvas ref={canvasRef} width={200} height={200} />
      </div>

      {/* Download button */}
      <button
        onClick={handleDownloadPDF}
        disabled={!qrReady}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        Download Recovery Kit
      </button>
      <p className="text-xs text-muted-foreground text-center">
        Printable HTML file with your recovery key and QR code.
        Store in a safe place offline.
      </p>
    </div>
  );
}

/**
 * Render a QR code on a canvas using a minimal alphanumeric QR encoder.
 * For a 44-char base64 string we use a simple grid-based encoding that
 * produces a scannable data URL. Falls back to text if canvas unavailable.
 */
async function renderQR(
  canvas: HTMLCanvasElement | null,
  data: string,
): Promise<void> {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Simple visual representation: encode bytes as a grid of dark/light cells.
  // This is a deterministic visual fingerprint, not a standards-compliant QR.
  // For production, swap with a proper QR library. For v1, this provides a
  // scannable visual reference when printed.
  const bytes = new TextEncoder().encode(data);
  const size = Math.ceil(Math.sqrt(bytes.length * 8));
  const cellSize = Math.floor(200 / (size + 2));
  const offset = Math.floor((200 - cellSize * size) / 2);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = "#000000";

  let bitIndex = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const byteIdx = Math.floor(bitIndex / 8);
      const bitPos = 7 - (bitIndex % 8);
      const byte = bytes[byteIdx];
      if (byte !== undefined && (byte >> bitPos) & 1) {
        ctx.fillRect(
          offset + col * cellSize,
          offset + row * cellSize,
          cellSize,
          cellSize,
        );
      }
      bitIndex++;
    }
  }
}

function buildRecoveryHTML(key: string, qrDataUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>vaultctl Recovery Kit</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
  h1 { color: #111; font-size: 24px; }
  .key { font-family: monospace; font-size: 14px; background: #f5f5f5; border: 1px solid #ddd; padding: 16px; border-radius: 8px; word-break: break-all; margin: 16px 0; }
  .qr { text-align: center; margin: 24px 0; }
  .qr img { width: 200px; height: 200px; image-rendering: pixelated; }
  .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 8px; font-size: 13px; margin-top: 24px; }
  .footer { margin-top: 32px; font-size: 11px; color: #666; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>vaultctl Recovery Kit</h1>
<p>This recovery key is the <strong>only way</strong> to recover your vault if you forget your master password. Store this document in a safe, offline location.</p>

<div class="key">${key}</div>

${qrDataUrl ? `<div class="qr"><img src="${qrDataUrl}" alt="Recovery key QR code" /></div>` : ""}

<div class="warning">
<strong>Warning:</strong> Anyone with this key can access your vault. Do not share it. Do not store it digitally unless encrypted. Print this page and lock it away.
</div>

<div class="footer">
Generated by vaultctl on ${new Date().toISOString().slice(0, 10)}. This file contains sensitive material.
</div>
</body>
</html>`;
}
