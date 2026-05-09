// SPDX-License-Identifier: AGPL-3.0-or-later

export const queryKeys = {
  vaults: {
    all: ["vaults"] as const,
    list: () => [...queryKeys.vaults.all, "list"] as const,
  },
  items: {
    all: (vaultId: string) => ["items", vaultId] as const,
    list: (vaultId: string) => [...queryKeys.items.all(vaultId), "list"] as const,
    detail: (vaultId: string, id: string) =>
      [...queryKeys.items.all(vaultId), id] as const,
  },
  folders: {
    list: (vaultId: string) => ["folders", vaultId] as const,
  },
  trash: {
    list: (vaultId: string) => ["trash", vaultId] as const,
  },
};
