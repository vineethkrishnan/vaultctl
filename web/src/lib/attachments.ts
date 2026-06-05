// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Client-side encrypted attachments.
 *
 * Each file gets a fresh 256-bit file key. The file bytes are sealed with
 * AES-256-GCM under that file key; the file key and the filename are then
 * wrapped under the vault key (via the crypto Worker). The server only ever
 * stores ciphertext plus the wrapped key material, so it never sees plaintext
 * file contents or names - the same zero-knowledge model as item data.
 */

import { aesGcmEncryptToBytes, aesGcmDecryptFromBytes, buf, zero } from "@/shared/crypto";
import { encryptData, decryptData } from "./key-holder";
import { apiGet, apiUpload, apiDownloadBytes, apiDelete } from "./api-client";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface AttachmentMeta {
  id: string;
  itemId: string;
  encryptedFilename: string;
  wrappedFileKey: string;
  size: number;
  sha256: string;
  createdAt: string;
}

function basePath(vaultId: string, itemId: string): string {
  return `/api/v1/vaults/${vaultId}/items/${itemId}/attachments`;
}

export function listAttachments(
  vaultId: string,
  itemId: string,
): Promise<AttachmentMeta[]> {
  return apiGet<AttachmentMeta[]>(basePath(vaultId, itemId));
}

export async function uploadAttachment(
  vaultId: string,
  itemId: string,
  file: File,
): Promise<AttachmentMeta> {
  const fileKey = crypto.getRandomValues(new Uint8Array(32));
  try {
    const plaintext = new Uint8Array(await file.arrayBuffer());
    const ciphertext = await aesGcmEncryptToBytes(fileKey, plaintext);
    const wrappedFileKey = await encryptData(vaultId, fileKey);
    const encryptedFilename = await encryptData(
      vaultId,
      encoder.encode(file.name),
    );

    const form = new FormData();
    form.append("encryptedFilename", encryptedFilename);
    form.append("wrappedFileKey", wrappedFileKey);
    form.append(
      "file",
      new Blob([buf(ciphertext)], { type: "application/octet-stream" }),
      "blob",
    );
    return await apiUpload<AttachmentMeta>(basePath(vaultId, itemId), form);
  } finally {
    zero(fileKey);
  }
}

export async function decryptFilename(
  vaultId: string,
  attachment: AttachmentMeta,
): Promise<string> {
  return decoder.decode(await decryptData(vaultId, attachment.encryptedFilename));
}

/** Download, decrypt, and hand the plaintext file to the browser as a save. */
export async function downloadAttachment(
  vaultId: string,
  itemId: string,
  attachment: AttachmentMeta,
): Promise<void> {
  const { bytes } = await apiDownloadBytes(
    `${basePath(vaultId, itemId)}/${attachment.id}`,
  );
  const fileKey = await decryptData(vaultId, attachment.wrappedFileKey);
  let plaintext: Uint8Array;
  try {
    plaintext = await aesGcmDecryptFromBytes(fileKey, bytes);
  } finally {
    zero(fileKey);
  }
  const filename = await decryptFilename(vaultId, attachment);
  triggerDownload(plaintext, filename);
}

export function deleteAttachment(
  vaultId: string,
  itemId: string,
  attachmentId: string,
): Promise<void> {
  return apiDelete<void>(`${basePath(vaultId, itemId)}/${attachmentId}`);
}

function triggerDownload(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([buf(bytes)], { type: "application/octet-stream" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "attachment";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
