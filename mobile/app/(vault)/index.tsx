// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import type { VaultResponse } from '@vaultctl/shared/types/api';
import { listVaults } from '../../src/sync/db';
import { syncAll } from '../../src/sync/engine';
import { useAuthStore } from '../../src/store/auth';
import { lock } from '../../src/store/keys';
import { clearBiometricEnrollment } from '../../src/biometric';

const VAULT_TYPE_LABEL: Record<string, string> = {
  personal: 'Personal',
  shared: 'Shared',
};

export default function VaultListScreen() {
  const router = useRouter();
  const { logout } = useAuthStore();
  const [vaults, setVaults] = useState<VaultResponse[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadVaults = useCallback(async () => {
    const cached = await listVaults();
    setVaults(cached);
  }, []);

  useEffect(() => {
    loadVaults();
    // Sync in background on mount.
    syncAll().then(() => loadVaults()).catch(() => {});
  }, [loadVaults]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await syncAll();
      await loadVaults();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleLock() {
    lock();
    useAuthStore.getState().lock();
    router.replace('/lock');
  }

  async function handleLogout() {
    Alert.alert('Sign out', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          lock();
          await clearBiometricEnrollment();
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={vaults}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/(vault)/${item.id}`)}
          >
            <View>
              <Text style={styles.vaultName}>{item.name}</Text>
              <Text style={styles.vaultType}>{VAULT_TYPE_LABEL[item.type] ?? item.type}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />
        }
        contentContainerStyle={vaults.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>No vaults. Pull to refresh.</Text>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <TouchableOpacity style={styles.footerButton} onPress={handleLock}>
              <Text style={styles.footerButtonText}>Lock Vault</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.footerButton} onPress={handleLogout}>
              <Text style={[styles.footerButtonText, { color: '#ef4444' }]}>Sign out</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 8 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { color: '#555', fontSize: 15 },
  card: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  vaultName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  vaultType: { color: '#888', fontSize: 13, marginTop: 2 },
  chevron: { color: '#555', fontSize: 22 },
  footer: { padding: 16, gap: 12, marginTop: 8 },
  footerButton: { paddingVertical: 12, alignItems: 'center' },
  footerButtonText: { color: '#aaa', fontSize: 15 },
});
