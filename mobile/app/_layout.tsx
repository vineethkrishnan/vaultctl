// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';

import { useServerStore } from '../src/store/server';
import { useAuthStore } from '../src/store/auth';
import { openDb } from '../src/sync/db';
import { isUnlocked } from '../src/store/keys';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { serverUrl, loadServerUrl } = useServerStore();
  const { isAuthenticated, isLocked, loadFromStorage } = useAuthStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([loadServerUrl(), loadFromStorage(), openDb()]).then(() =>
      setReady(true),
    );
  }, []);

  useEffect(() => {
    if (!ready) return;

    const inAuth = segments[0] === '(auth)';
    const inLock = segments[0] === 'lock';

    if (!serverUrl) {
      if (!inAuth) router.replace('/(auth)/server');
      return;
    }

    if (!isAuthenticated) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }

    if (isLocked || !isUnlocked()) {
      if (!inLock) router.replace('/lock');
      return;
    }

    if (inAuth || inLock) {
      router.replace('/(vault)');
    }
  }, [ready, serverUrl, isAuthenticated, isLocked, segments]);

  if (!ready) return null;
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <AuthGuard>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(vault)" />
          <Stack.Screen name="lock" />
        </Stack>
      </AuthGuard>
    </QueryClientProvider>
  );
}
