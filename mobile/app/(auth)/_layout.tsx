// SPDX-License-Identifier: AGPL-3.0-or-later

import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: true, title: '' }}>
      <Stack.Screen name="server" options={{ title: 'Server Setup', headerShown: false }} />
      <Stack.Screen name="login" options={{ title: 'Sign In', headerShown: false }} />
      <Stack.Screen name="totp" options={{ title: 'Two-Factor Auth' }} />
    </Stack>
  );
}
