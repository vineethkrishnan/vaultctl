// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useVaults } from '../../src/presentation/hooks/useVaults';
import { VaultDto } from '../../src/application/dtos/VaultDtos';

const TYPE_LABEL: Record<string, string> = {
  personal: 'Personal',
  shared: 'Shared',
};

function VaultRow({ vault, onPress }: { vault: VaultDto; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <Text style={styles.rowIconText}>{vault.type === 'personal' ? 'P' : 'S'}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {vault.name}
        </Text>
        <Text style={styles.rowMeta}>
          {TYPE_LABEL[vault.type] ?? vault.type} · {vault.role}
        </Text>
      </View>
      <Text style={styles.chevron}>{'>'}</Text>
    </TouchableOpacity>
  );
}

export default function VaultListScreen() {
  const router = useRouter();
  const { data: vaults, isLoading, isError, refetch, syncAndRefresh } = useVaults();
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const navItems = [
    { label: 'Search', route: '/search' },
    { label: 'Favorites', route: '/favorites' },
    { label: 'Trash', route: '/trash' },
    { label: 'Settings', route: '/settings' },
  ] as const;

  useEffect(() => {
    setSyncing(true);
    syncAndRefresh().finally(() => setSyncing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await syncAndRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading && !vaults) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>Loading...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to load vaults</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {syncing && !refreshing && (
        <View style={styles.syncBar}>
          <Text style={styles.syncText}>Syncing...</Text>
        </View>
      )}
      <View style={styles.quickNav}>
        {navItems.map((nav) => (
          <TouchableOpacity
            key={nav.label}
            onPress={() => router.push(nav.route as Parameters<typeof router.push>[0])}
            style={styles.quickNavBtn}
          >
            <Text style={styles.quickNavText}>{nav.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={vaults ?? []}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => (
          <VaultRow
            vault={item}
            onPress={() =>
              router.push(`/(vault)/${item.id}` as Parameters<typeof router.push>[0])
            }
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#2563eb"
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.centerText}>No vaults found</Text>
          </View>
        }
        contentContainerStyle={vaults?.length === 0 ? styles.emptyContainer : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  emptyContainer: { flex: 1 },
  centerText: { color: '#aaa', fontSize: 14 },
  errorText: { color: '#ef4444', fontSize: 14 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 8, backgroundColor: '#1a1a1a', borderRadius: 8 },
  retryText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
  syncBar: { backgroundColor: '#1a1a1a', paddingVertical: 6, alignItems: 'center' },
  syncText: { color: '#666', fontSize: 12 },
  quickNav: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  quickNavBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
  },
  quickNavText: { color: '#aaa', fontSize: 13, fontWeight: '500' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#1d3561',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowIconText: { color: '#93c5fd', fontSize: 16, fontWeight: '700' },
  rowBody: { flex: 1, gap: 2 },
  rowName: { color: '#e5e5e5', fontSize: 16, fontWeight: '500' },
  rowMeta: { color: '#666', fontSize: 12 },
  chevron: { color: '#444', fontSize: 16 },
});
