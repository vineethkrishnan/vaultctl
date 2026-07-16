// SPDX-License-Identifier: AGPL-3.0-or-later

import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useItemDetail } from '../../../src/presentation/hooks/useItems';
import { useDeleteItem, useToggleFavorite } from '../../../src/presentation/hooks/useItemMutations';
import { CopyField } from '../../../src/presentation/components/CopyField';
import { TotpCounter } from '../../../src/presentation/components/TotpCounter';
import type {
  LoginData,
  SecureNoteData,
  CreditCardData,
  IdentityData,
  ApiKeyData,
  SSHKeyData,
  PasskeyData,
  GPGKeyData,
} from '@vaultctl/shared/types/item-data';

function LoginDetail({ data }: { data: LoginData }) {
  return (
    <>
      <CopyField label="Username" value={data.username} />
      <CopyField label="Password" value={data.password} secret />
      <CopyField label="URL" value={data.uri} />
      {data.totp ? <TotpCounter uri={data.totp} /> : null}
      <CopyField label="Notes" value={data.notes} />
      {data.customFields.map((f, i) => (
        <CopyField key={i} label={f.name} value={f.value} secret={f.type === 'hidden'} />
      ))}
    </>
  );
}

function SecureNoteDetail({ data }: { data: SecureNoteData }) {
  return (
    <>
      <CopyField label="Content" value={data.content} secret />
      <CopyField label="Notes" value={data.notes} />
      {data.customFields.map((f, i) => (
        <CopyField key={i} label={f.name} value={f.value} secret={f.type === 'hidden'} />
      ))}
    </>
  );
}

function CreditCardDetail({ data }: { data: CreditCardData }) {
  return (
    <>
      <CopyField label="Cardholder" value={data.cardholderName} />
      <CopyField label="Number" value={data.number} secret />
      <CopyField label="Expiry" value={data.expiry} />
      <CopyField label="CVV" value={data.cvv} secret />
      <CopyField label="Card Type" value={data.cardType} />
      <CopyField label="Notes" value={data.notes} />
      {data.customFields.map((f, i) => (
        <CopyField key={i} label={f.name} value={f.value} secret={f.type === 'hidden'} />
      ))}
    </>
  );
}

function IdentityDetail({ data }: { data: IdentityData }) {
  return (
    <>
      <CopyField label="First Name" value={data.firstName} />
      <CopyField label="Last Name" value={data.lastName} />
      <CopyField label="Email" value={data.email} />
      <CopyField label="Phone" value={data.phone} />
      <CopyField label="Address" value={data.address} />
      <CopyField label="City" value={data.city} />
      <CopyField label="State" value={data.state} />
      <CopyField label="Country" value={data.country} />
      <CopyField label="Postal Code" value={data.postalCode} />
      <CopyField label="SSN" value={data.ssn} secret />
      <CopyField label="Passport" value={data.passportNumber} secret />
      <CopyField label="License" value={data.licenseNumber} secret />
      <CopyField label="Notes" value={data.notes} />
      {data.customFields.map((f, i) => (
        <CopyField key={i} label={f.name} value={f.value} secret={f.type === 'hidden'} />
      ))}
    </>
  );
}

function ApiKeyDetail({ data }: { data: ApiKeyData }) {
  return (
    <>
      <CopyField label="API Key" value={data.key} secret />
      <CopyField label="Environment" value={data.environment} />
      <CopyField label="Service URL" value={data.serviceUrl} />
      <CopyField label="Expires At" value={data.expiresAt} />
      <CopyField label="Notes" value={data.notes} />
      {data.customFields.map((f, i) => (
        <CopyField key={i} label={f.name} value={f.value} secret={f.type === 'hidden'} />
      ))}
    </>
  );
}

function GPGKeyDetail({ data }: { data: GPGKeyData }) {
  return (
    <>
      <CopyField label="User ID" value={data.uid} />
      <CopyField label="Key ID" value={data.keyId} />
      <CopyField label="Fingerprint" value={data.fingerprint} />
      <CopyField label="Key Type" value={data.keyType} />
      <CopyField label="Expires" value={data.expiresAt} />
      <CopyField label="Public Key" value={data.publicKey} />
      <CopyField label="Private Key" value={data.privateKey} secret />
      <CopyField label="Passphrase" value={data.passphrase} secret />
      <CopyField label="Notes" value={data.notes} />
      {data.customFields.map((f, i) => (
        <CopyField key={i} label={f.name} value={f.value} secret={f.type === 'hidden'} />
      ))}
    </>
  );
}

function SSHKeyDetail({ data }: { data: SSHKeyData }) {
  return (
    <>
      <CopyField label="Public Key" value={data.publicKey} />
      <CopyField label="Private Key" value={data.privateKey} secret />
      <CopyField label="Passphrase" value={data.passphrase} secret />
      <CopyField label="Key Type" value={data.keyType} />
      <CopyField label="Fingerprint" value={data.fingerprint} />
      <CopyField label="Host" value={data.host} />
      <CopyField label="Notes" value={data.notes} />
      {data.customFields.map((f, i) => (
        <CopyField key={i} label={f.name} value={f.value} secret={f.type === 'hidden'} />
      ))}
    </>
  );
}

function PasskeyDetail({ data }: { data: PasskeyData }) {
  return (
    <>
      <CopyField label="RP ID" value={data.rpId} />
      <CopyField label="RP Name" value={data.rpName} />
      <CopyField label="Credential ID" value={data.credentialId} />
      <CopyField label="User Handle" value={data.userHandle} />
      <CopyField label="Public Key" value={data.publicKey} />
      <CopyField label="Discoverable" value={data.discoverable ? 'Yes' : 'No'} />
      <CopyField label="Notes" value={data.notes} />
      {data.customFields.map((f, i) => (
        <CopyField key={i} label={f.name} value={f.value} secret={f.type === 'hidden'} />
      ))}
    </>
  );
}

function ItemFields({ itemType, data }: { itemType: string; data: unknown }) {
  switch (itemType) {
    case 'login':
      return <LoginDetail data={data as LoginData} />;
    case 'secure_note':
      return <SecureNoteDetail data={data as SecureNoteData} />;
    case 'credit_card':
      return <CreditCardDetail data={data as CreditCardData} />;
    case 'identity':
      return <IdentityDetail data={data as IdentityData} />;
    case 'api_key':
      return <ApiKeyDetail data={data as ApiKeyData} />;
    case 'ssh_key':
      return <SSHKeyDetail data={data as SSHKeyData} />;
    case 'passkey':
      return <PasskeyDetail data={data as PasskeyData} />;
    case 'gpg_key':
      return <GPGKeyDetail data={data as GPGKeyData} />;
    default:
      return (
        <View style={styles.unknownType}>
          <Text style={styles.unknownTypeText}>Unknown item type: {itemType}</Text>
        </View>
      );
  }
}

export default function ItemDetailScreen() {
  const { vaultId, itemId } = useLocalSearchParams<{ vaultId: string; itemId: string }>();
  const router = useRouter();
  const { data: item, isLoading, isError } = useItemDetail(itemId!);
  const { mutateAsync: deleteItem, isPending: isDeleting } = useDeleteItem(vaultId!);
  const { mutateAsync: toggleFavorite, isPending: isTogglingFavorite } = useToggleFavorite(vaultId!);

  async function handleDelete() {
    Alert.alert('Delete Item', 'Move this item to trash?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Move to Trash',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteItem({ itemId: itemId! });
            router.back();
          } catch {
            Alert.alert('Error', 'Failed to delete item.');
          }
        },
      },
    ]);
  }

  async function handleToggleFavorite() {
    if (!item) return;
    try {
      await toggleFavorite({ itemId: itemId!, isFavorite: !item.isFavorite });
    } catch {
      Alert.alert('Error', 'Failed to update favorite.');
    }
  }

  if (isLoading) {
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.actionBar}>
        <TouchableOpacity
          onPress={() =>
            router.push(
              `/(vault)/${vaultId}/edit/${itemId}` as Parameters<typeof router.push>[0],
            )
          }
          style={styles.actionBtn}
        >
          <Text style={styles.actionBtnText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleToggleFavorite}
          style={styles.actionBtn}
          disabled={isTogglingFavorite}
        >
          <Text style={[styles.actionBtnText, item.isFavorite && styles.activeText]}>
            {item.isFavorite ? 'Unfavorite' : 'Favorite'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleDelete}
          style={styles.actionBtn}
          disabled={isDeleting}
        >
          <Text style={[styles.actionBtnText, styles.destructiveText]}>Delete</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {item.decryptedName}
        </Text>
        <Text style={styles.typeTag}>{item.itemType.replace('_', ' ')}</Text>
      </View>
      <View style={styles.fields}>
        <ItemFields itemType={item.itemType} data={item.decryptedData} />
      </View>
      <View style={styles.meta}>
        <Text style={styles.metaText}>Updated {new Date(item.updatedAt).toLocaleDateString()}</Text>
        {item.isFavorite && <Text style={styles.metaText}>Favorite</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  errorText: { color: '#ef4444', fontSize: 14 },
  backBtn: { paddingHorizontal: 20, paddingVertical: 8, backgroundColor: '#1a1a1a', borderRadius: 8 },
  backBtnText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
  actionBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  actionBtn: { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#111', borderRadius: 8 },
  actionBtnText: { color: '#2563eb', fontSize: 13, fontWeight: '600' },
  activeText: { color: '#ca8a04' },
  destructiveText: { color: '#ef4444' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    gap: 8,
  },
  title: { color: '#e5e5e5', fontSize: 22, fontWeight: '700' },
  typeTag: {
    alignSelf: 'flex-start',
    color: '#93c5fd',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    backgroundColor: '#1d3561',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  fields: { paddingHorizontal: 20 },
  unknownType: { paddingVertical: 20 },
  unknownTypeText: { color: '#666', fontSize: 14 },
  meta: {
    paddingHorizontal: 20,
    paddingTop: 24,
    flexDirection: 'row',
    gap: 16,
  },
  metaText: { color: '#444', fontSize: 12 },
});
