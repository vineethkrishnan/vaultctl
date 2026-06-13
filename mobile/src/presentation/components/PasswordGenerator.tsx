// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Switch,
} from 'react-native';
import { useSecretClipboard } from '../hooks/useSecretClipboard';

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';

function generatePassword(
  length: number,
  charsets: { chars: string; required: boolean }[],
): string {
  const activeCharsets = charsets.filter((c) => c.required);
  if (activeCharsets.length === 0) return '';

  const fullCharset = activeCharsets.map((c) => c.chars).join('');
  const charsetLen = fullCharset.length;

  const maxAcceptable = 256 - (256 % charsetLen);
  const result: string[] = [];

  while (result.length < length) {
    const batch = new Uint8Array(length * 2);
    crypto.getRandomValues(batch);
    for (const byte of batch) {
      if (byte >= maxAcceptable) continue;
      result.push(fullCharset[byte % charsetLen]!);
      if (result.length === length) break;
    }
  }

  for (let i = 0; i < activeCharsets.length; i++) {
    const { chars } = activeCharsets[i]!;
    const hasOne = result.some((c) => chars.includes(c));
    if (!hasOne) {
      const posBytes = new Uint32Array(1);
      crypto.getRandomValues(posBytes);
      const pos = posBytes[0]! % length;
      const charMax = 256 - (256 % chars.length);
      let chosen = '';
      while (!chosen) {
        const b = new Uint8Array(1);
        crypto.getRandomValues(b);
        if (b[0]! < charMax) chosen = chars[b[0]! % chars.length]!;
      }
      result[pos] = chosen;
    }
  }

  return result.join('');
}

interface Props {
  onUse: (password: string) => void;
}

export function PasswordGenerator({ onUse }: Props) {
  const [length, setLength] = useState(20);
  const [useUpper, setUseUpper] = useState(true);
  const [useLower, setUseLower] = useState(true);
  const [useDigits, setUseDigits] = useState(true);
  const [useSymbols, setUseSymbols] = useState(false);
  const [generated, setGenerated] = useState('');
  const { copy, copied } = useSecretClipboard();

  useEffect(() => {
    return () => {
      setGenerated('');
    };
  }, []);

  function generate() {
    const charsets = [
      { chars: UPPERCASE, required: useUpper },
      { chars: LOWERCASE, required: useLower },
      { chars: DIGITS, required: useDigits },
      { chars: SYMBOLS, required: useSymbols },
    ];
    setGenerated(generatePassword(length, charsets));
  }

  return (
    <View style={styles.container}>
      <View style={styles.options}>
        <View style={styles.lengthRow}>
          <Text style={styles.label}>Length: {length}</Text>
          <View style={styles.lengthBtns}>
            <TouchableOpacity
              onPress={() => setLength((l) => Math.max(8, l - 2))}
              style={styles.stepBtn}
            >
              <Text style={styles.stepBtnText}>-</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setLength((l) => Math.min(64, l + 2))}
              style={styles.stepBtn}
            >
              <Text style={styles.stepBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        <ToggleRow label="Uppercase (A-Z)" value={useUpper} onChange={setUseUpper} />
        <ToggleRow label="Lowercase (a-z)" value={useLower} onChange={setUseLower} />
        <ToggleRow label="Numbers (0-9)" value={useDigits} onChange={setUseDigits} />
        <ToggleRow label="Symbols (!@#...)" value={useSymbols} onChange={setUseSymbols} />
      </View>

      <TouchableOpacity onPress={generate} style={styles.generateBtn}>
        <Text style={styles.generateBtnText}>Generate</Text>
      </TouchableOpacity>

      {generated ? (
        <View style={styles.result}>
          <Text style={styles.generatedPassword} numberOfLines={2} selectable>
            {generated}
          </Text>
          <View style={styles.resultActions}>
            <TouchableOpacity onPress={() => copy(generated, true)} style={styles.actionBtn}>
              <Text style={styles.actionBtnText}>{copied ? 'Copied!' : 'Copy'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onUse(generated)}
              style={[styles.actionBtn, styles.useBtn]}
            >
              <Text style={[styles.actionBtnText, styles.useBtnText]}>Use This</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#333', true: '#2563eb' }}
        thumbColor={value ? '#fff' : '#888'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  options: { gap: 0, backgroundColor: '#111', borderRadius: 12, overflow: 'hidden' },
  lengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  label: { color: '#e5e5e5', fontSize: 15 },
  lengthBtns: { flexDirection: 'row', gap: 8 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBtnText: { color: '#2563eb', fontSize: 18, fontWeight: '700', lineHeight: 22 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  toggleLabel: { color: '#e5e5e5', fontSize: 15 },
  generateBtn: {
    backgroundColor: '#1d3561',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  generateBtnText: { color: '#93c5fd', fontSize: 15, fontWeight: '600' },
  result: {
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  generatedPassword: {
    color: '#22c55e',
    fontSize: 15,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  resultActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
  },
  actionBtnText: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  useBtn: { backgroundColor: '#2563eb' },
  useBtnText: { color: '#fff' },
});
