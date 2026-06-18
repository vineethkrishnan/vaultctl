// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../src/presentation/hooks/useAuth';
import { useAutoLock, useActiveSessions, useServerUrl } from '../src/presentation/hooks/useSettings';
import { container } from '../src/container';
import { AutoLockMinutes } from '../src/infrastructure/config/AutoLockRepository';

const AUTO_LOCK_OPTIONS: { label: string; value: AutoLockMinutes }[] = [
  { label: 'Never', value: 0 },
  { label: '1 minute', value: 1 },
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
];

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>{children}</View>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const auth = useAuth();
  const { autoLockMinutes, setAutoLock } = useAutoLock();
  const serverUrl = useServerUrl();
  const { data: sessions, isLoading: sessionsLoading, refetch: refetchSessions, revoke } = useActiveSessions();

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [biometricWorking, setBiometricWorking] = useState(false);
  const [pinSet, setPinSet] = useState(false);
  const [pinWorking, setPinWorking] = useState(false);

  useEffect(() => {
    Promise.all([
      container.biometricService.isAvailable(),
      container.biometricService.isEnrolled(),
    ]).then(([avail, enrolled]) => {
      setBiometricAvailable(avail);
      setBiometricEnrolled(enrolled);
    }).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      container.pinService.isSet().then(setPinSet).catch(() => {});
    }, []),
  );

  function handlePinToggle(enable: boolean) {
    if (enable) {
      router.push('/set-pin' as Parameters<typeof router.push>[0]);
      return;
    }
    Alert.alert('Remove PIN?', 'You will no longer be able to unlock with a PIN.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setPinWorking(true);
          try {
            await auth.disablePin();
            setPinSet(false);
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Failed to remove PIN.');
          } finally {
            setPinWorking(false);
          }
        },
      },
    ]);
  }

  async function handleBiometricToggle(enable: boolean) {
    setBiometricWorking(true);
    try {
      if (enable) {
        await auth.enableBiometric();
        setBiometricEnrolled(true);
        Alert.alert('Biometrics enabled', 'You can now unlock with Face ID / Touch ID.');
      } else {
        await auth.disableBiometric();
        setBiometricEnrolled(false);
      }
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update biometrics.');
    } finally {
      setBiometricWorking(false);
    }
  }

  async function handleRevokeSession(sessionId: string, isCurrent: boolean) {
    const msg = isCurrent
      ? 'Revoking the current session will log you out.'
      : 'This session will be immediately terminated.';
    Alert.alert('Revoke session?', msg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          try {
            await revoke.mutateAsync(sessionId);
            if (isCurrent) {
              await auth.logout();
            }
          } catch {
            Alert.alert('Error', 'Failed to revoke session.');
          }
        },
      },
    ]);
  }

  async function handleLogout() {
    Alert.alert('Log out', 'You will need to log in again to access your vaults.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          try {
            await auth.logout();
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Logout failed.');
          }
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <SectionHeader title="Security" />

      {biometricAvailable && (
        <SettingsRow label="Face ID / Touch ID">
          {biometricWorking ? (
            <ActivityIndicator color="#2563eb" />
          ) : (
            <Switch
              value={biometricEnrolled}
              onValueChange={handleBiometricToggle}
              trackColor={{ false: '#333', true: '#2563eb' }}
              thumbColor={biometricEnrolled ? '#fff' : '#888'}
            />
          )}
        </SettingsRow>
      )}

      <SettingsRow label="PIN unlock">
        {pinWorking ? (
          <ActivityIndicator color="#2563eb" />
        ) : (
          <Switch
            value={pinSet}
            onValueChange={handlePinToggle}
            trackColor={{ false: '#333', true: '#2563eb' }}
            thumbColor={pinSet ? '#fff' : '#888'}
          />
        )}
      </SettingsRow>

      <View style={styles.block}>
        <Text style={styles.blockLabel}>Auto-lock</Text>
        <View style={styles.segmented}>
          {AUTO_LOCK_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              onPress={() => setAutoLock(opt.value)}
              style={[styles.segment, autoLockMinutes === opt.value && styles.segmentActive]}
            >
              <Text
                style={[
                  styles.segmentText,
                  autoLockMinutes === opt.value && styles.segmentTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <SectionHeader title="Server" />

      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>URL</Text>
        <Text style={styles.infoValue} numberOfLines={1}>{serverUrl ?? 'Not configured'}</Text>
      </View>

      <SectionHeader title="Active Sessions" />

      {sessionsLoading && (
        <View style={styles.center}>
          <ActivityIndicator color="#2563eb" />
        </View>
      )}

      {!sessionsLoading && (sessions ?? []).map((session) => (
        <View key={session.id} style={styles.sessionRow}>
          <View style={styles.sessionBody}>
            <Text style={styles.sessionDate}>
              Last used {new Date(session.lastUsedAt).toLocaleDateString()}
            </Text>
            {session.isCurrent && <Text style={styles.sessionCurrent}>Current session</Text>}
          </View>
          <TouchableOpacity
            onPress={() => handleRevokeSession(session.id, session.isCurrent)}
            style={styles.revokeBtn}
          >
            <Text style={styles.revokeBtnText}>Revoke</Text>
          </TouchableOpacity>
        </View>
      ))}

      {!sessionsLoading && (sessions ?? []).length === 0 && (
        <Text style={styles.emptyText}>No sessions found</Text>
      )}

      <TouchableOpacity onPress={() => refetchSessions()} style={styles.refreshBtn}>
        <Text style={styles.refreshBtnText}>Refresh sessions</Text>
      </TouchableOpacity>

      <SectionHeader title="Account" />

      <TouchableOpacity
        onPress={() => router.push('/change-password' as Parameters<typeof router.push>[0])}
        style={styles.menuBtn}
      >
        <Text style={styles.menuBtnText}>Change Master Password</Text>
        <Text style={styles.chevron}>{'>'}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleLogout} style={[styles.menuBtn, styles.dangerBtn]}>
        <Text style={styles.dangerBtnText}>Log out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { paddingBottom: 60 },
  sectionHeader: {
    color: '#555',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  rowLabel: { color: '#e5e5e5', fontSize: 15 },
  rowRight: { flexDirection: 'row', alignItems: 'center' },
  block: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 10 },
  blockLabel: { color: '#e5e5e5', fontSize: 15 },
  segmented: { flexDirection: 'row', gap: 6 },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
  },
  segmentActive: { backgroundColor: '#1d3561', borderColor: '#2563eb' },
  segmentText: { color: '#666', fontSize: 13, fontWeight: '500' },
  segmentTextActive: { color: '#93c5fd' },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  infoLabel: { color: '#555', fontSize: 13, width: 60 },
  infoValue: { flex: 1, color: '#aaa', fontSize: 13 },
  center: { paddingVertical: 20, alignItems: 'center' },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    gap: 12,
  },
  sessionBody: { flex: 1, gap: 3 },
  sessionDate: { color: '#aaa', fontSize: 14 },
  sessionCurrent: { color: '#2563eb', fontSize: 12, fontWeight: '600' },
  revokeBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#1a1a1a', borderRadius: 7 },
  revokeBtnText: { color: '#ef4444', fontSize: 12, fontWeight: '600' },
  emptyText: { color: '#444', fontSize: 14, paddingHorizontal: 20, paddingVertical: 14 },
  refreshBtn: { marginHorizontal: 20, marginTop: 8, alignSelf: 'flex-start' },
  refreshBtnText: { color: '#2563eb', fontSize: 13 },
  menuBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  menuBtnText: { color: '#e5e5e5', fontSize: 15 },
  chevron: { color: '#444', fontSize: 16 },
  dangerBtn: { marginTop: 16, borderBottomWidth: 0 },
  dangerBtnText: { color: '#ef4444', fontSize: 15, fontWeight: '500' },
});
