// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const RT_KEY = 'vaultctl_rt';
const SID_KEY = 'vaultctl_sid';
const UID_KEY = 'vaultctl_uid';

interface AuthState {
  userId: string | null;
  role: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  sessionId: string | null;
  isAuthenticated: boolean;
  isLocked: boolean;

  setAuth: (data: {
    userId: string;
    role: string;
    accessToken: string;
    refreshToken: string;
    sessionId: string;
  }) => Promise<void>;

  setTokens: (accessToken: string, refreshToken: string) => Promise<void>;

  restoreLocked: (data: {
    userId: string;
    role: string;
    accessToken: string;
    refreshToken: string;
  }) => void;

  lock: () => void;
  unlock: () => void;
  logout: () => Promise<void>;

  loadFromStorage: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  role: null,
  accessToken: null,
  refreshToken: null,
  sessionId: null,
  isAuthenticated: false,
  isLocked: false,

  setAuth: async (data) => {
    await SecureStore.setItemAsync(RT_KEY, data.refreshToken);
    await SecureStore.setItemAsync(SID_KEY, data.sessionId);
    await SecureStore.setItemAsync(UID_KEY, data.userId);
    set({
      ...data,
      isAuthenticated: true,
      isLocked: false,
    });
  },

  setTokens: async (accessToken, refreshToken) => {
    await SecureStore.setItemAsync(RT_KEY, refreshToken);
    set({ accessToken, refreshToken });
  },

  restoreLocked: (data) => {
    set({
      ...data,
      sessionId: null,
      isAuthenticated: true,
      isLocked: true,
    });
  },

  lock: () => set({ isLocked: true, accessToken: null }),

  unlock: () => set({ isLocked: false }),

  logout: async () => {
    await SecureStore.deleteItemAsync(RT_KEY);
    await SecureStore.deleteItemAsync(SID_KEY);
    await SecureStore.deleteItemAsync(UID_KEY);
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

  loadFromStorage: async () => {
    const refreshToken = await SecureStore.getItemAsync(RT_KEY);
    const userId = await SecureStore.getItemAsync(UID_KEY);
    if (refreshToken && userId) {
      set({ refreshToken, userId, isAuthenticated: true, isLocked: true });
    }
  },
}));
