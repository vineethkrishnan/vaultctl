// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { AuthGuard } from '../src/presentation/navigation/AuthGuard';
import { autoLockRepository } from '../src/container';
import { useAuth } from '../src/presentation/hooks/useAuth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function AutoLockManager() {
  const auth = useAuth();
  const backgroundAt = useRef<number | null>(null);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        backgroundAt.current = Date.now();
        const minutes = await autoLockRepository.load();
        if (minutes > 0) {
          lockTimer.current = setTimeout(
            () => {
              auth.lockVault();
            },
            minutes * 60 * 1000,
          );
        }
      } else if (next === 'active') {
        if (lockTimer.current) {
          clearTimeout(lockTimer.current);
          lockTimer.current = null;
        }
        backgroundAt.current = null;
      }
    });

    return () => {
      sub.remove();
      if (lockTimer.current) clearTimeout(lockTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <AuthGuard>
        <AutoLockManager />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(vault)" />
          <Stack.Screen name="lock" />
          <Stack.Screen name="search" options={{ headerShown: true, title: 'Search', headerStyle: { backgroundColor: '#0a0a0a' }, headerTintColor: '#e5e5e5' }} />
          <Stack.Screen name="favorites" options={{ headerShown: true, title: 'Favorites', headerStyle: { backgroundColor: '#0a0a0a' }, headerTintColor: '#e5e5e5' }} />
          <Stack.Screen name="trash" options={{ headerShown: true, title: 'Trash', headerStyle: { backgroundColor: '#0a0a0a' }, headerTintColor: '#e5e5e5' }} />
          <Stack.Screen name="settings" options={{ headerShown: true, title: 'Settings', headerStyle: { backgroundColor: '#0a0a0a' }, headerTintColor: '#e5e5e5' }} />
          <Stack.Screen name="change-password" options={{ headerShown: true, title: 'Change Password', headerStyle: { backgroundColor: '#0a0a0a' }, headerTintColor: '#e5e5e5' }} />
        </Stack>
      </AuthGuard>
    </QueryClientProvider>
  );
}
