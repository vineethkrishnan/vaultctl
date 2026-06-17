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
import { useRouter } from 'expo-router';
import { FormField } from '../src/presentation/components/FormField';
import { container } from '../src/container';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isWorking, setIsWorking] = useState(false);

  async function handleSubmit() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Required', 'Please fill in all fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 12) {
      Alert.alert('Too short', 'New master password must be at least 12 characters.');
      return;
    }

    Alert.alert(
      'Change master password?',
      'This re-encrypts all your vault keys. You will need to log in again on all other devices.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change',
          style: 'destructive',
          onPress: async () => {
            setIsWorking(true);
            try {
              await container.cryptoService;
              Alert.alert(
                'Not available',
                'Master password change is not yet supported on mobile. Use the web app to change your master password.',
              );
            } finally {
              setIsWorking(false);
            }
          },
        },
      ],
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>Important</Text>
          <Text style={styles.warningBody}>
            Changing your master password re-derives your encryption keys and re-encrypts all vault
            access. You will need to log in again on all other sessions. If anything goes wrong
            mid-operation your data could become inaccessible. Make sure you have a recovery kit
            before proceeding.
          </Text>
        </View>

        <View style={styles.fields}>
          <FormField
            label="Current password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secret
            autoFocus
          />
          <FormField
            label="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            secret
          />
          <FormField
            label="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secret
          />
        </View>

        <TouchableOpacity
          onPress={handleSubmit}
          style={[styles.submitBtn, isWorking && styles.submitBtnDisabled]}
          disabled={isWorking}
        >
          <Text style={styles.submitBtnText}>{isWorking ? 'Working...' : 'Change password'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.back()} style={styles.cancelBtn}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, gap: 24, paddingBottom: 48 },
  warning: {
    backgroundColor: '#1c0a0a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    gap: 8,
  },
  warningTitle: { color: '#fca5a5', fontSize: 13, fontWeight: '700' },
  warningBody: { color: '#fca5a5', fontSize: 13, lineHeight: 20 },
  fields: { gap: 16 },
  submitBtn: {
    backgroundColor: '#991b1b',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { alignItems: 'center', paddingVertical: 12 },
  cancelBtnText: { color: '#555', fontSize: 15 },
});
