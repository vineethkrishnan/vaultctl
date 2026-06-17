// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

export interface AuthAppState {
  isReady: boolean;
  hasServerUrl: boolean;
  isAuthenticated: boolean;
  isLocked: boolean;
  userId: string | null;
}

interface AuthActions {
  setReady(isReady: boolean): void;
  setHasServerUrl(has: boolean): void;
  setAuthenticated(userId: string): void;
  setLocked(locked: boolean): void;
  reset(): void;
}

const initial: AuthAppState = {
  isReady: false,
  hasServerUrl: false,
  isAuthenticated: false,
  isLocked: false,
  userId: null,
};

export const useAuthStore = create<AuthAppState & AuthActions>((set) => ({
  ...initial,
  setReady: (isReady) => set({ isReady }),
  setHasServerUrl: (hasServerUrl) => set({ hasServerUrl }),
  setAuthenticated: (userId) => set({ isAuthenticated: true, isLocked: false, userId }),
  setLocked: (isLocked) => set({ isLocked }),
  reset: () => set(initial),
}));
