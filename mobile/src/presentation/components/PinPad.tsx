// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const PIN_LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

interface Props {
  title: string;
  subtitle?: string;
  error?: string | null;
  disabled?: boolean;
  onComplete: (pin: string) => void;
}

export function PinPad({ title, subtitle, error, disabled, onComplete }: Props) {
  const [digits, setDigits] = useState('');

  useEffect(() => {
    if (digits.length === PIN_LENGTH) {
      const pin = digits;
      setDigits('');
      onComplete(pin);
    }
  }, [digits, onComplete]);

  function press(key: string) {
    if (disabled) return;
    if (key === 'del') {
      setDigits((d) => d.slice(0, -1));
      return;
    }
    if (key === '') return;
    setDigits((d) => (d.length < PIN_LENGTH ? d + key : d));
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      <View style={styles.dots}>
        {Array.from({ length: PIN_LENGTH }).map((_, index) => (
          <View
            key={index}
            style={[styles.dot, index < digits.length ? styles.dotFilled : null]}
          />
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : <View style={styles.errorSpacer} />}

      <View style={styles.keypad}>
        {KEYS.map((key, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.key, key === '' ? styles.keyEmpty : null]}
            onPress={() => press(key)}
            disabled={disabled || key === ''}
            activeOpacity={0.6}
          >
            <Text style={styles.keyText}>{key === 'del' ? '⌫' : key}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: '700', color: '#fff', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 8 },
  dots: { flexDirection: 'row', gap: 18, marginVertical: 16 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#555',
  },
  dotFilled: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  error: { color: '#ef4444', fontSize: 13, height: 18 },
  errorSpacer: { height: 18 },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 280,
    justifyContent: 'space-between',
    rowGap: 14,
  },
  key: {
    width: 80,
    height: 64,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyEmpty: { backgroundColor: 'transparent' },
  keyText: { color: '#fff', fontSize: 24, fontWeight: '500' },
});
