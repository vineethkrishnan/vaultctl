// SPDX-License-Identifier: AGPL-3.0-or-later

import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { AuthGuard } from '../src/presentation/navigation/AuthGuard';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

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
