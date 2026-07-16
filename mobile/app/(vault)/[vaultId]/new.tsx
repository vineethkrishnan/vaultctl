// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FormField } from '../../../src/presentation/components/FormField';
import { ItemFormFields, FormValues, DEFAULT_VALUES } from '../../../src/presentation/components/ItemFormFields';
import { useCreateItem } from '../../../src/presentation/hooks/useItemMutations';

const ITEM_TYPES = [
  { type: 'login', label: 'Login', description: 'Username, password, URL' },
  { type: 'secure_note', label: 'Secure Note', description: 'Encrypted text content' },
  { type: 'credit_card', label: 'Credit Card', description: 'Card number, expiry, CVV' },
  { type: 'identity', label: 'Identity', description: 'Personal information' },
  { type: 'api_key', label: 'API Key', description: 'Service credentials' },
  { type: 'ssh_key', label: 'SSH Key', description: 'Public / private key pair' },
  { type: 'passkey', label: 'Passkey', description: 'WebAuthn credential' },
  { type: 'gpg_key', label: 'GPG Key', description: 'Armored PGP key pair' },
];

export default function NewItemScreen() {
  const { vaultId } = useLocalSearchParams<{ vaultId: string }>();
  const router = useRouter();
  const { mutateAsync: create, isPending } = useCreateItem(vaultId!);

  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [values, setValues] = useState<FormValues>({});

  function selectType(type: string) {
    setSelectedType(type);
    setValues(DEFAULT_VALUES[type] ?? {});
  }

  function handleChange(key: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!selectedType || !name.trim()) {
      Alert.alert('Required', 'Please enter a name for this item.');
      return;
    }
    try {
      await create({
        vaultId: vaultId!,
        itemType: selectedType,
        name: name.trim(),
        data: values,
      });
      router.back();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to save item.');
    }
  }

  if (!selectedType) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.pickerContent}>
        <Text style={styles.pickerTitle}>Choose item type</Text>
        {ITEM_TYPES.map((t) => (
          <TouchableOpacity
            key={t.type}
            style={styles.typeRow}
            onPress={() => selectType(t.type)}
            activeOpacity={0.7}
          >
            <View style={styles.typeBody}>
              <Text style={styles.typeLabel}>{t.label}</Text>
              <Text style={styles.typeDesc}>{t.description}</Text>
            </View>
            <Text style={styles.chevron}>{'>'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <TouchableOpacity
          onPress={() => setSelectedType(null)}
          style={styles.changeTypeBtn}
        >
          <Text style={styles.changeTypeBtnText}>
            {'< '}{ITEM_TYPES.find((t) => t.type === selectedType)?.label ?? selectedType}
          </Text>
        </TouchableOpacity>
        <View style={styles.fields}>
          <FormField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. GitHub"
            autoFocus
          />
          <ItemFormFields itemType={selectedType} values={values} onChange={handleChange} />
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
  pickerContent: { padding: 20, gap: 0 },
  pickerTitle: { color: '#666', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 16 },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    gap: 12,
  },
  typeBody: { flex: 1, gap: 3 },
  typeLabel: { color: '#e5e5e5', fontSize: 16, fontWeight: '500' },
  typeDesc: { color: '#555', fontSize: 13 },
  chevron: { color: '#444', fontSize: 16 },
  formContent: { padding: 20, gap: 20, paddingBottom: 48 },
  changeTypeBtn: { alignSelf: 'flex-start' },
  changeTypeBtnText: { color: '#2563eb', fontSize: 15, fontWeight: '500' },
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
