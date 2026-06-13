// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { useAuth } from '../hooks/useAuth';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const { isReady, hasServerUrl, isAuthenticated, isLocked, init } = useAuth();

  useEffect(() => {
    init().catch(console.error);
  }, []);

  useEffect(() => {
    if (!isReady) return;

    const inAuth = segments[0] === '(auth)';
    const inLock = segments[0] === 'lock';

    if (!hasServerUrl) {
      if (!inAuth) router.replace('/(auth)/server');
      return;
    }

    if (!isAuthenticated) {
      if (!inAuth) router.replace('/(auth)/login');
      return;
    }

    if (isLocked) {
      if (!inLock) router.replace('/lock');
      return;
    }

    if (inAuth || inLock) {
      router.replace('/(vault)');
    }
  }, [isReady, hasServerUrl, isAuthenticated, isLocked, segments]);

  if (!isReady) return null;
  return <>{children}</>;
}
