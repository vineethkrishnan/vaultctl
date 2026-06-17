// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { container, autoLockRepository } from '../../container';
import { AutoLockMinutes } from '../../infrastructure/config/AutoLockRepository';
import { SessionInfo } from '../../domain/auth/ports/IAuthService';

export function useAutoLock() {
  const queryClient = useQueryClient();

  const query = useQuery<AutoLockMinutes>({
    queryKey: ['autolock'],
    queryFn: () => autoLockRepository.load(),
  });

  const mutation = useMutation({
    mutationFn: (minutes: AutoLockMinutes) => autoLockRepository.save(minutes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['autolock'] }),
  });

  return {
    autoLockMinutes: query.data ?? 5,
    setAutoLock: mutation.mutate,
    isSaving: mutation.isPending,
  };
}

export function useActiveSessions() {
  const queryClient = useQueryClient();

  const query = useQuery<SessionInfo[]>({
    queryKey: ['sessions'],
    queryFn: () => container.getActiveSessions.execute(),
  });

  const revoke = useMutation({
    mutationFn: (sessionId: string) => container.revokeSession.execute(sessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  return { ...query, revoke };
}

export function useServerUrl() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    container.serverConfig.load()
      .then((serverUrl) => setUrl(serverUrl?.value ?? null))
      .catch(() => setUrl(null));
  }, []);

  return url;
}
