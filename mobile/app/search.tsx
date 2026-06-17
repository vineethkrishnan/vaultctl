// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useGlobalSearch } from '../src/presentation/hooks/useGlobalSearch';
import { ItemSummaryDto } from '../src/application/dtos/ItemDtos';

const TYPE_ICON: Record<string, string> = {
  login: 'L',
  secure_note: 'N',
  credit_card: 'C',
  identity: 'I',
  api_key: 'K',
  ssh_key: 'S',
  passkey: 'P',
};

function ResultRow({ item, onPress }: { item: ItemSummaryDto; onPress: () => void }) {
  const icon = TYPE_ICON[item.itemType] ?? '?';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <Text style={styles.rowIconText}>{icon}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.decryptedName ?? '(encrypted)'}
        </Text>
        <Text style={styles.rowMeta}>{item.itemType.replace('_', ' ')}</Text>
      </View>
      <Text style={styles.chevron}>{'>'}</Text>
    </TouchableOpacity>
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const { query, setQuery, results, isSearching, error } = useGlobalSearch();

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="Search all vaults..."
          placeholderTextColor="#555"
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      {isSearching && (
        <View style={styles.center}>
          <ActivityIndicator color="#2563eb" />
        </View>
      )}

      {!isSearching && error && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isSearching && !error && query.trim() && results.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No results for "{query}"</Text>
        </View>
      )}

      {!isSearching && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ResultRow
              item={item}
              onPress={() =>
                router.push(
                  `/(vault)/${item.vaultId}/${item.id}` as Parameters<typeof router.push>[0],
                )
              }
            />
          )}
        />
      )}

      {!query.trim() && (
        <View style={styles.hint}>
          <Text style={styles.hintText}>Type to search across all vaults</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  searchBar: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  input: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#e5e5e5',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#ef4444', fontSize: 14 },
  emptyText: { color: '#555', fontSize: 14 },
  hint: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  hintText: { color: '#333', fontSize: 14 },
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
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowIconText: { color: '#2563eb', fontSize: 14, fontWeight: '700' },
  rowBody: { flex: 1, gap: 2 },
  rowName: { color: '#e5e5e5', fontSize: 15, fontWeight: '500' },
  rowMeta: { color: '#555', fontSize: 12 },
  chevron: { color: '#444', fontSize: 16 },
});
