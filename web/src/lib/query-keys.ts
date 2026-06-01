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
  attachments: {
    list: (vaultId: string, itemId: string) =>
      ["attachments", vaultId, itemId] as const,
  },
  folders: {
    list: (vaultId: string) => ["folders", vaultId] as const,
  },
  trash: {
    list: (vaultId: string) => ["trash", vaultId] as const,
  },
  backup: {
    all: ["backup"] as const,
    providers: () => [...queryKeys.backup.all, "providers"] as const,
    destinations: () => [...queryKeys.backup.all, "destinations"] as const,
    runs: (destinationId: string) =>
      [...queryKeys.backup.all, "runs", destinationId] as const,
    artifacts: (destinationId: string) =>
      [...queryKeys.backup.all, "artifacts", destinationId] as const,
  },
};
