// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSecretClipboard } from '../hooks/useSecretClipboard';

interface Props {
  label: string;
  value: string;
  secret?: boolean;
}

export function CopyField({ label, value, secret = false }: Props) {
  const [revealed, setRevealed] = useState(false);
  const { copy, copied } = useSecretClipboard();

  const display = secret && !revealed ? '•'.repeat(Math.min(value.length, 20)) : value;

  if (!value) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Text style={styles.value} numberOfLines={secret && !revealed ? 1 : undefined}>
          {display}
        </Text>
        <View style={styles.actions}>
          {secret && (
            <TouchableOpacity onPress={() => setRevealed((r) => !r)} style={styles.action}>
              <Text style={styles.actionText}>{revealed ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => copy(value, secret)} style={styles.action}>
            <Text style={styles.actionText}>
              {copied ? (secret ? 'Copied (clears in 30s)' : 'Copied') : 'Copy'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  label: { fontSize: 12, color: '#666', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { flex: 1, fontSize: 16, color: '#e5e5e5' },
  actions: { flexDirection: 'row', gap: 8 },
  action: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#1a1a1a', borderRadius: 6 },
  actionText: { fontSize: 12, color: '#2563eb', fontWeight: '600' },
});
