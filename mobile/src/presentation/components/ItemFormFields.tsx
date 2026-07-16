// SPDX-License-Identifier: AGPL-3.0-or-later

import { View, Text, Switch, StyleSheet } from 'react-native';
import { FormField } from './FormField';
import { PasswordGenerator } from './PasswordGenerator';

export type FormValues = Record<string, string | boolean>;

export const DEFAULT_VALUES: Record<string, FormValues> = {
  login: { username: '', password: '', uri: '', totp: '', notes: '' },
  secure_note: { content: '', notes: '' },
  credit_card: { cardholderName: '', number: '', expiry: '', cvv: '', cardType: '', notes: '' },
  identity: {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    country: '',
    postalCode: '',
    ssn: '',
    passportNumber: '',
    licenseNumber: '',
    notes: '',
  },
  api_key: { key: '', environment: '', serviceUrl: '', expiresAt: '', notes: '' },
  ssh_key: {
    publicKey: '',
    privateKey: '',
    passphrase: '',
    keyType: '',
    fingerprint: '',
    host: '',
    notes: '',
  },
  passkey: {
    rpId: '',
    rpName: '',
    credentialId: '',
    userHandle: '',
    publicKey: '',
    discoverable: false,
    notes: '',
  },
  gpg_key: {
    uid: '',
    keyId: '',
    fingerprint: '',
    keyType: '',
    expiresAt: '',
    publicKey: '',
    privateKey: '',
    passphrase: '',
    notes: '',
  },
};

interface Props {
  itemType: string;
  values: FormValues;
  onChange: (key: string, value: string | boolean) => void;
}

function str(v: string | boolean | undefined): string {
  if (typeof v === 'string') return v;
  return '';
}

function bool(v: string | boolean | undefined): boolean {
  return v === true;
}

export function ItemFormFields({ itemType, values, onChange }: Props) {
  const set = (key: string) => (val: string | boolean) => onChange(key, val);

  switch (itemType) {
    case 'login':
      return (
        <>
          <FormField label="Username" value={str(values['username'])} onChangeText={set('username')} autoCapitalize="none" />
          <FormField label="Password" value={str(values['password'])} onChangeText={set('password')} secret />
          <PasswordGenerator onUse={(pw) => onChange('password', pw)} />
          <FormField label="URL" value={str(values['uri'])} onChangeText={set('uri')} keyboardType="url" />
          <FormField label="TOTP secret / URI" value={str(values['totp'])} onChangeText={set('totp')} />
          <FormField label="Notes" value={str(values['notes'])} onChangeText={set('notes')} multiline />
        </>
      );

    case 'secure_note':
      return (
        <>
          <FormField label="Content" value={str(values['content'])} onChangeText={set('content')} multiline />
          <FormField label="Notes" value={str(values['notes'])} onChangeText={set('notes')} multiline />
        </>
      );

    case 'credit_card':
      return (
        <>
          <FormField label="Cardholder Name" value={str(values['cardholderName'])} onChangeText={set('cardholderName')} autoCapitalize="words" />
          <FormField label="Card Number" value={str(values['number'])} onChangeText={set('number')} keyboardType="number-pad" secret />
          <FormField label="Expiry (MM/YY)" value={str(values['expiry'])} onChangeText={set('expiry')} />
          <FormField label="CVV" value={str(values['cvv'])} onChangeText={set('cvv')} keyboardType="number-pad" secret />
          <FormField label="Card Type" value={str(values['cardType'])} onChangeText={set('cardType')} />
          <FormField label="Notes" value={str(values['notes'])} onChangeText={set('notes')} multiline />
        </>
      );

    case 'identity':
      return (
        <>
          <FormField label="First Name" value={str(values['firstName'])} onChangeText={set('firstName')} autoCapitalize="words" />
          <FormField label="Last Name" value={str(values['lastName'])} onChangeText={set('lastName')} autoCapitalize="words" />
          <FormField label="Email" value={str(values['email'])} onChangeText={set('email')} keyboardType="email-address" />
          <FormField label="Phone" value={str(values['phone'])} onChangeText={set('phone')} keyboardType="phone-pad" />
          <FormField label="Address" value={str(values['address'])} onChangeText={set('address')} />
          <FormField label="City" value={str(values['city'])} onChangeText={set('city')} />
          <FormField label="State" value={str(values['state'])} onChangeText={set('state')} />
          <FormField label="Country" value={str(values['country'])} onChangeText={set('country')} />
          <FormField label="Postal Code" value={str(values['postalCode'])} onChangeText={set('postalCode')} />
          <FormField label="SSN" value={str(values['ssn'])} onChangeText={set('ssn')} secret />
          <FormField label="Passport Number" value={str(values['passportNumber'])} onChangeText={set('passportNumber')} secret />
          <FormField label="License Number" value={str(values['licenseNumber'])} onChangeText={set('licenseNumber')} secret />
          <FormField label="Notes" value={str(values['notes'])} onChangeText={set('notes')} multiline />
        </>
      );

    case 'api_key':
      return (
        <>
          <FormField label="API Key" value={str(values['key'])} onChangeText={set('key')} secret />
          <FormField label="Environment" value={str(values['environment'])} onChangeText={set('environment')} />
          <FormField label="Service URL" value={str(values['serviceUrl'])} onChangeText={set('serviceUrl')} keyboardType="url" />
          <FormField label="Expires At" value={str(values['expiresAt'])} onChangeText={set('expiresAt')} placeholder="YYYY-MM-DD" />
          <FormField label="Notes" value={str(values['notes'])} onChangeText={set('notes')} multiline />
        </>
      );

    case 'ssh_key':
      return (
        <>
          <FormField label="Public Key" value={str(values['publicKey'])} onChangeText={set('publicKey')} multiline />
          <FormField label="Private Key" value={str(values['privateKey'])} onChangeText={set('privateKey')} multiline secret />
          <FormField label="Passphrase" value={str(values['passphrase'])} onChangeText={set('passphrase')} secret />
          <FormField label="Key Type (e.g. ed25519)" value={str(values['keyType'])} onChangeText={set('keyType')} />
          <FormField label="Fingerprint" value={str(values['fingerprint'])} onChangeText={set('fingerprint')} />
          <FormField label="Host" value={str(values['host'])} onChangeText={set('host')} />
          <FormField label="Notes" value={str(values['notes'])} onChangeText={set('notes')} multiline />
        </>
      );

    case 'passkey':
      return (
        <>
          <FormField label="RP ID" value={str(values['rpId'])} onChangeText={set('rpId')} />
          <FormField label="RP Name" value={str(values['rpName'])} onChangeText={set('rpName')} />
          <FormField label="Credential ID" value={str(values['credentialId'])} onChangeText={set('credentialId')} />
          <FormField label="User Handle" value={str(values['userHandle'])} onChangeText={set('userHandle')} />
          <FormField label="Public Key" value={str(values['publicKey'])} onChangeText={set('publicKey')} multiline />
          <View style={styles.boolRow}>
            <Text style={styles.boolLabel}>Discoverable</Text>
            <Switch
              value={bool(values['discoverable'])}
              onValueChange={set('discoverable')}
              trackColor={{ false: '#333', true: '#2563eb' }}
              thumbColor={bool(values['discoverable']) ? '#fff' : '#888'}
            />
          </View>
          <FormField label="Notes" value={str(values['notes'])} onChangeText={set('notes')} multiline />
        </>
      );

    case 'gpg_key':
      return (
        <>
          <FormField label="User ID" value={str(values['uid'])} onChangeText={set('uid')} />
          <FormField label="Key ID" value={str(values['keyId'])} onChangeText={set('keyId')} />
          <FormField label="Fingerprint" value={str(values['fingerprint'])} onChangeText={set('fingerprint')} />
          <FormField label="Key Type (e.g. RSA 4096)" value={str(values['keyType'])} onChangeText={set('keyType')} />
          <FormField label="Expires" value={str(values['expiresAt'])} onChangeText={set('expiresAt')} />
          <FormField label="Public Key" value={str(values['publicKey'])} onChangeText={set('publicKey')} multiline />
          <FormField label="Private Key" value={str(values['privateKey'])} onChangeText={set('privateKey')} multiline secret />
          <FormField label="Passphrase" value={str(values['passphrase'])} onChangeText={set('passphrase')} secret />
          <FormField label="Notes" value={str(values['notes'])} onChangeText={set('notes')} multiline />
        </>
      );

    default:
      return <Text style={styles.unknown}>Unknown item type</Text>;
  }
}

const styles = StyleSheet.create({
  boolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  boolLabel: { color: '#e5e5e5', fontSize: 15 },
  unknown: { color: '#666', fontSize: 14 },
});
