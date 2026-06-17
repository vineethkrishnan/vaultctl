// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FormField } from '../../../../src/presentation/components/FormField';
import { ItemFormFields, FormValues, DEFAULT_VALUES } from '../../../../src/presentation/components/ItemFormFields';
import { useItemDetail } from '../../../../src/presentation/hooks/useItems';
import { useUpdateItem } from '../../../../src/presentation/hooks/useItemMutations';

export default function EditItemScreen() {
  const { vaultId, itemId } = useLocalSearchParams<{ vaultId: string; itemId: string }>();
  const router = useRouter();
  const { data: item, isLoading, isError } = useItemDetail(itemId!);
  const { mutateAsync: update, isPending } = useUpdateItem(vaultId!);

  const [name, setName] = useState('');
  const [values, setValues] = useState<FormValues>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (item && !initialized) {
      setName(item.decryptedName);
      const defaultsForType = DEFAULT_VALUES[item.itemType] ?? {};
      const dataFromItem = item.decryptedData as Record<string, unknown>;
      const merged: FormValues = { ...defaultsForType };
      for (const key of Object.keys(defaultsForType)) {
        const v = dataFromItem[key];
        if (typeof v === 'string' || typeof v === 'boolean') {
          merged[key] = v;
        }
      }
      setValues(merged);
      setInitialized(true);
    }
  }, [item, initialized]);

  function handleChange(key: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter a name for this item.');
      return;
    }
    try {
      await update({
        itemId: itemId!,
        vaultId: vaultId!,
        name: name.trim(),
        data: values,
      });
      router.back();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to save item.');
    }
  }

  if (isLoading || !initialized) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#2563eb" />
      </View>
    );
  }

  if (isError || !item) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to load item</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.fields}>
          <FormField label="Name" value={name} onChangeText={setName} />
          <ItemFormFields itemType={item.itemType} values={values} onChange={handleChange} />
        </View>
        <TouchableOpacity
          onPress={handleSave}
          style={[styles.saveBtn, isPending && styles.saveBtnDisabled]}
          disabled={isPending}
        >
          <Text style={styles.saveBtnText}>{isPending ? 'Saving...' : 'Save'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#ef4444', fontSize: 14 },
  content: { padding: 20, gap: 20, paddingBottom: 48 },
  fields: { gap: 16 },
  saveBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
