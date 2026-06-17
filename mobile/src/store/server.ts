// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const SERVER_URL_KEY = 'vaultctl_server_url';

interface ServerState {
  serverUrl: string | null;
  setServerUrl: (url: string) => Promise<void>;
  clearServerUrl: () => Promise<void>;
  loadServerUrl: () => Promise<void>;
}

export const useServerStore = create<ServerState>((set) => ({
  serverUrl: null,

  setServerUrl: async (url) => {
    const trimmed = url.replace(/\/$/, '');
    await SecureStore.setItemAsync(SERVER_URL_KEY, trimmed);
    set({ serverUrl: trimmed });
  },

  clearServerUrl: async () => {
    await SecureStore.deleteItemAsync(SERVER_URL_KEY);
    set({ serverUrl: null });
  },

  loadServerUrl: async () => {
    const url = await SecureStore.getItemAsync(SERVER_URL_KEY);
    set({ serverUrl: url });
  },
}));

export function apiUrl(path: string): string {
  const url = useServerStore.getState().serverUrl;
  if (!url) throw new Error('No server URL configured');
  return `${url}/api/v1${path}`;
}
