// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

/**
 * Vaults the crypto worker refused at unlock because the sender's wrap
 * signature did not verify (H1).
 *
 * Their keys were never loaded, so the vaults cannot be opened. Keeping the ids
 * here lets the vault list say so out loud - a rejected vault silently missing
 * from the list looks identical to one that was un-shared, which is exactly the
 * confusion a key-substituting server would hide behind.
 */
interface VaultTrustState {
  rejectedVaultIds: string[];
  setRejectedVaultIds(vaultIds: string[]): void;
  clear(): void;
}

export const useVaultTrustStore = create<VaultTrustState>((set) => ({
  rejectedVaultIds: [],
  setRejectedVaultIds: (vaultIds) => set({ rejectedVaultIds: vaultIds }),
  clear: () => set({ rejectedVaultIds: [] }),
}));
