// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Clipboard,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { getItem } from '../../../src/sync/db';
import { decryptData, decryptName } from '../../../src/store/keys';
import {
  loginDataSchema,
  secureNoteDataSchema,
  creditCardDataSchema,
} from '@vaultctl/shared/types/item-data';
import { fromBase64 } from '@vaultctl/shared/crypto/utils';

interface Field {
  label: string;
  value: string;
  sensitive?: boolean;
}

const COPY_TIMEOUT_MS = 30_000;
let clearClipboardTimer: ReturnType<typeof setTimeout> | null = null;

function copyWithAutoClear(value: string, label: string) {
  Clipboard.setString(value);
  if (clearClipboardTimer) clearTimeout(clearClipboardTimer);
  clearClipboardTimer = setTimeout(() => {
    Clipboard.setString('');
  }, COPY_TIMEOUT_MS);
  Alert.alert('Copied', `${label} copied. Clipboard will clear in 30 seconds.`, [
    { text: 'OK' },
  ]);
}

function parseItemFields(itemType: string, data: unknown): Field[] {
  try {
    if (itemType === 'login') {
      const d = loginDataSchema.parse(data);
      return [
        { label: 'Username', value: d.username },
        { label: 'Password', value: d.password, sensitive: true },
        { label: 'URL', value: d.uri },
        { label: 'TOTP Secret', value: d.totp, sensitive: true },
        { label: 'Notes', value: d.notes },
      ].filter((f) => f.value);
    }
    if (itemType === 'secure_note') {
      const d = secureNoteDataSchema.parse(data);
      return [{ label: 'Note', value: d.content }].filter((f) => f.value);
    }
    if (itemType === 'credit_card') {
      const d = creditCardDataSchema.parse(data);
      return [
        { label: 'Cardholder', value: d.cardholderName },
        { label: 'Number', value: d.number, sensitive: true },
        { label: 'Expiry', value: d.expiry },
        { label: 'CVV', value: d.cvv, sensitive: true },
      ].filter((f) => f.value);
    }
  } catch {}
  return [];
}

export default function ItemDetailScreen() {
  const { vaultId, itemId } = useLocalSearchParams<{
    vaultId: string;
    itemId: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [fields, setFields] = useState<Field[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const item = await getItem(itemId);
        if (!item) throw new Error('Item not found in local cache');

        const [decryptedName, decryptedDataBytes] = await Promise.all([
          decryptName(item.vaultId, item.encryptedName),
          decryptData(item.vaultId, item.encryptedData),
        ]);

        const dataJson = JSON.parse(new TextDecoder().decode(decryptedDataBytes));

        if (!cancelled) {
          setName(decryptedName);
          setFields(parseItemFields(item.itemType, dataJson));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to decrypt item');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{name}</Text>

      {fields.map((field) => {
        const isRevealed = revealed.has(field.label);
        const displayValue = field.sensitive && !isRevealed
          ? '••••••••'
          : field.value;

        return (
          <View key={field.label} style={styles.field}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldValue} selectable numberOfLines={field.sensitive ? 1 : undefined}>
                {displayValue}
              </Text>
              <View style={styles.fieldActions}>
                {field.sensitive && (
                  <TouchableOpacity
                    onPress={() =>
                      setRevealed((prev) => {
                        const next = new Set(prev);
                        if (next.has(field.label)) next.delete(field.label);
                        else next.add(field.label);
                        return next;
                      })
                    }
                  >
                    <Text style={styles.action}>{isRevealed ? 'Hide' : 'Show'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => copyWithAutoClear(field.value, field.label)}>
                  <Text style={styles.action}>Copy</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#ef4444', fontSize: 15 },
  container: { flex: 1 },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 8 },
  field: {
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
    gap: 6,
  },
  fieldLabel: { color: '#888', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  fieldValue: { flex: 1, color: '#fff', fontSize: 15 },
  fieldActions: { flexDirection: 'row', gap: 10 },
  action: { color: '#2563eb', fontSize: 14, fontWeight: '500' },
});
