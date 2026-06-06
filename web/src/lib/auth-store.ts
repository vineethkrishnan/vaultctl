// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from "zustand";

interface AuthState {
  userId: string | null;
  role: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  sessionId: string | null;
  isAuthenticated: boolean;
  isLocked: boolean;

  setAuth(data: {
    userId: string;
    role: string;
    accessToken: string;
    refreshToken: string;
    sessionId: string;
  }): void;
  setTokens(accessToken: string, refreshToken: string): void;
  /**
   * Mark the session authenticated but locked after a silent token refresh on a
   * cold load (full-page reload or OAuth redirect return). The crypto worker has
   * no vault keys at this point - they derive from the master password at login
   * - so the vault is NOT usable until the user re-enters it on /lock.
   */
  restoreLocked(data: {
    userId: string;
    role: string;
    accessToken: string;
    refreshToken: string;
  }): void;
  lock(): void;
  unlock(): void;
  logout(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  role: null,
  accessToken: null,
  refreshToken: sessionStorage.getItem("vaultctl_rt"),
  sessionId: sessionStorage.getItem("vaultctl_sid"),
  isAuthenticated: false,
  isLocked: false,

  setAuth: (data) => {
    sessionStorage.setItem("vaultctl_rt", data.refreshToken);
    sessionStorage.setItem("vaultctl_sid", data.sessionId);
    set({
      userId: data.userId,
      role: data.role,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      sessionId: data.sessionId,
      isAuthenticated: true,
      isLocked: false,
    });
  },

  setTokens: (accessToken, refreshToken) => {
    sessionStorage.setItem("vaultctl_rt", refreshToken);
    set({ accessToken, refreshToken });
  },

  restoreLocked: (data) => {
    sessionStorage.setItem("vaultctl_rt", data.refreshToken);
    set({
      userId: data.userId,
      role: data.role,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      isAuthenticated: true,
      isLocked: true,
    });
  },

  lock: () => set({ isLocked: true }),

  unlock: () => set({ isLocked: false }),

  logout: () => {
    sessionStorage.removeItem("vaultctl_rt");
    sessionStorage.removeItem("vaultctl_sid");
    set({
      userId: null,
      role: null,
      accessToken: null,
      refreshToken: null,
      sessionId: null,
      isAuthenticated: false,
      isLocked: false,
    });
  },
}));
