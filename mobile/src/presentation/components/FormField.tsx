// SPDX-License-Identifier: AGPL-3.0-or-later

import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  multiline?: boolean;
  secret?: boolean;
}

export function FormField({ label, value, onChangeText, multiline, secret, ...rest }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor="#444"
        secureTextEntry={secret}
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        autoCorrect={false}
        autoCapitalize="none"
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 12, color: '#666', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#e5e5e5',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#222',
  },
  multilineInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
