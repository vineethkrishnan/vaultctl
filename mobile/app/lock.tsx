// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';

import { unlockWithBiometrics, isBiometricEnrolled } from '../src/biometric';
import { initKeys } from '../src/store/keys';
import { useAuthStore } from '../src/store/auth';
import { syncAll } from '../src/sync/engine';

export default function LockScreen() {
  const router = useRouter();
  const { unlock, logout } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);

  useEffect(() => {
    isBiometricEnrolled().then(setHasBiometric);
    // Attempt biometric unlock automatically on mount.
    attemptBiometricUnlock();
  }, []);

  async function attemptBiometricUnlock() {
    const enrolled = await isBiometricEnrolled();
    if (!enrolled) return;

    setLoading(true);
    try {
      const params = await unlockWithBiometrics();
      await initKeys(params);
      unlock();
      syncAll().catch(() => {});
      router.replace('/(vault)');
    } catch (err) {
      if ((err as Error).message !== 'BIOMETRIC_NOT_ENROLLED') {
        // User cancelled or biometric failed; show the UI for manual retry.
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.replace('/(auth)/login');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔒</Text>
      <Text style={styles.title}>Vault Locked</Text>
      <Text style={styles.subtitle}>Authenticate to access your vault.</Text>

      {loading ? (
        <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 24 }} />
      ) : (
        <TouchableOpacity style={styles.button} onPress={attemptBiometricUnlock}>
          <Text style={styles.buttonText}>
            {hasBiometric ? 'Unlock with Biometrics' : 'Unlock'}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 12 },
  icon: { fontSize: 56 },
  title: { fontSize: 26, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 15, color: '#888', textAlign: 'center' },
  button: { backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 15, paddingHorizontal: 40, marginTop: 16 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  logoutButton: { marginTop: 24 },
  logoutText: { color: '#555', fontSize: 14 },
});
