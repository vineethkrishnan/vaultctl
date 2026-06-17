// SPDX-License-Identifier: AGPL-3.0-or-later

import { Stack } from 'expo-router';

export default function VaultLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#111' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: '#0a0a0a' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Vaults' }} />
      <Stack.Screen name="[vaultId]/index" options={{ title: 'Items' }} />
      <Stack.Screen name="[vaultId]/[itemId]" options={{ title: 'Item' }} />
    </Stack>
  );
}
