// SPDX-License-Identifier: AGPL-3.0-or-later

import * as SecureStore from 'expo-secure-store';
import { ISessionRepository } from '../../domain/auth/ports/ISessionRepository';
import { Session } from '../../domain/auth/entities/Session';
import { UserId } from '../../domain/auth/value-objects/UserId';

const KEY_RT = 'vaultctl_rt';
const KEY_AT = 'vaultctl_at';
const KEY_UID = 'vaultctl_uid';
const KEY_ROLE = 'vaultctl_role';
const KEY_SID = 'vaultctl_sid';

export class SessionRepository implements ISessionRepository {
  async save(session: Session): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(KEY_RT, session.refreshToken),
      SecureStore.setItemAsync(KEY_AT, session.accessToken),
      SecureStore.setItemAsync(KEY_UID, session.userId.value),
      SecureStore.setItemAsync(KEY_ROLE, session.role),
      SecureStore.setItemAsync(KEY_SID, session.sessionId),
    ]);
  }

  async load(): Promise<Session | null> {
    const [refreshToken, accessToken, userId, role, sessionId] = await Promise.all([
      SecureStore.getItemAsync(KEY_RT),
      SecureStore.getItemAsync(KEY_AT),
      SecureStore.getItemAsync(KEY_UID),
      SecureStore.getItemAsync(KEY_ROLE),
      SecureStore.getItemAsync(KEY_SID),
    ]);

    if (!refreshToken || !userId || !role) return null;

    return Session.create({
      userId: UserId.of(userId),
      role,
      accessToken: accessToken ?? '',
      refreshToken,
      sessionId: sessionId ?? '',
    });
  }

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_RT),
      SecureStore.deleteItemAsync(KEY_AT),
      SecureStore.deleteItemAsync(KEY_UID),
      SecureStore.deleteItemAsync(KEY_ROLE),
      SecureStore.deleteItemAsync(KEY_SID),
    ]);
  }
}
