// SPDX-License-Identifier: AGPL-3.0-or-later

import { apiPost } from "./api-client";
import type { ItemResponse, ItemType } from "@/shared/types/api";

export interface ItemCreatePayload {
  folderId?: string;
  itemType: ItemType;
  encryptedData: string;
  encryptedName: string;
  favorite: boolean;
  reprompt: boolean;
}

export function createItem(
  vaultId: string,
  payload: ItemCreatePayload,
): Promise<ItemResponse> {
  return apiPost<ItemResponse>(`/api/v1/vaults/${vaultId}/items`, payload);
}
