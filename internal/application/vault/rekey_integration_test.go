// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	domainvault "github.com/vineethkrishnan/vaultctl/internal/domain/vault"
)

// ===========================================================================
// Milestone 8 / C2 acceptance: member removal triggers rekey; the removed
// admin's stored vault key fails to decrypt items written AFTER the rekey.
//
// The test uses REAL AES-256-GCM so the "read-only bypass not possible"
// assertion is load-bearing: an attacker caching the old vault key must
// genuinely fail to open new ciphertexts.
// ===========================================================================

// rsaBlobFor returns a valid RSA-OAEP blob carrying `marker` as ciphertext so
// test assertions can distinguish blobs by content while keeping the envelope
// well-formed. Shared-vault member wrapping uses AlgRSAOAEPSHA256.
func rsaBlobFor(marker byte) crypto.EncryptedBlob {
	return crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgRSAOAEPSHA256,
		Ciphertext: bytes.Repeat([]byte{marker}, 256),
	}
}

// testEd25519Sig returns a placeholder 64-byte signature (the domain only
// checks length, not signature validity — that's infra's job, see H1 notes).
func testEd25519Sig(t *testing.T) crypto.Signature {
	t.Helper()
	s, err := crypto.NewEd25519Signature(bytes.Repeat([]byte{0xEE}, crypto.Ed25519SignatureSize))
	if err != nil {
		t.Fatalf("sig: %v", err)
	}
	return s
}

// newAESKey mints a fresh 32-byte key for a rekey round.
func newAESKey(t *testing.T) []byte {
	t.Helper()
	k := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, k); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return k
}

// aesGCMSeal encrypts plaintext under key, returning a v1/AES-256-GCM blob.
func aesGCMSeal(t *testing.T, key, plaintext []byte) crypto.EncryptedBlob {
	t.Helper()
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("aes.NewCipher: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("cipher.NewGCM: %v", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		t.Fatalf("rand: %v", err)
	}
	sealed := gcm.Seal(nil, nonce, plaintext, nil)
	// cipher.GCM returns ciphertext || tag; the blob envelope stores them
	// separately so we split at the tag boundary.
	tagLen := gcm.Overhead()
	ciphertext := sealed[:len(sealed)-tagLen]
	tag := sealed[len(sealed)-tagLen:]
	return crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgAES256GCM,
		Nonce:      nonce,
		Ciphertext: ciphertext,
		Tag:        tag,
	}
}

// aesGCMOpen decrypts a blob under key. Returns the plaintext or a
// non-nil error on authentication failure.
func aesGCMOpen(key []byte, blob crypto.EncryptedBlob) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	sealed := make([]byte, 0, len(blob.Ciphertext)+len(blob.Tag))
	sealed = append(sealed, blob.Ciphertext...)
	sealed = append(sealed, blob.Tag...)
	return gcm.Open(nil, blob.Nonce, sealed, nil)
}

// sharedMember builds a validated shared-vault Member row.
func sharedMember(t *testing.T, vaultID domainvault.ID, userID, senderID user.ID, role user.Role) domainvault.Member {
	t.Helper()
	return domainvault.Member{
		VaultID:           vaultID,
		UserID:            userID,
		EncryptedVaultKey: rsaBlobFor(0x11),
		SenderID:          senderID,
		WrapSignature:     testEd25519Sig(t),
		Role:              role,
		AddedAt:           time.Unix(testClockSec, 0).UTC(),
	}
}

// seedSharedVaultWithMembers configures a shared vault V with admins A, B
// and plain member C. Returns nothing — helpers panic on error via t.Fatal.
func seedSharedVaultWithMembers(t *testing.T, vaults *fakeVaultRepo, vaultID domainvault.ID) {
	t.Helper()
	vaults.seedVault(domainvault.Vault{
		ID:        vaultID,
		Name:      "shared-one",
		Type:      domainvault.TypeShared,
		OrgID:     "org-1",
		CreatedBy: "A",
		CreatedAt: time.Unix(testClockSec, 0).UTC(),
	})
	vaults.seedMember(sharedMember(t, vaultID, "A", "A", user.RoleAdmin))
	vaults.seedMember(sharedMember(t, vaultID, "B", "A", user.RoleAdmin))
	vaults.seedMember(sharedMember(t, vaultID, "C", "A", user.RoleMember))
}

// TestRekey_RemovedAdminCannotDecryptNewItems is the canonical C2 acceptance
// test called out in architecture.md §8 Milestone 8:
//
//	"Integration test: admin removal triggers rekey; removed admin's stored
//	 vaultKey fails to decrypt new items written after removal"
//
// It exercises the full flow end-to-end with real AES-256-GCM so the
// "read-only bypass not possible" invariant is a genuine cryptographic
// assertion, not a string compare.
func TestRekey_RemovedAdminCannotDecryptNewItems(t *testing.T) {
	t.Parallel()

	vaults := newFakeVaultRepo()
	items := newFakeItemRepo()
	ctx := context.Background()

	const vaultID = domainvault.ID("V")
	seedSharedVaultWithMembers(t, vaults, vaultID)

	// Generate the ORIGINAL vault key. A, B, and C all conceptually hold
	// this key via their wrapped EncryptedVaultKey; the wrap step itself
	// is client-side and opaque to this layer.
	vaultKeyOld := newAESKey(t)

	// Seed item I1 encrypted under vaultKeyOld.
	plaintextI1 := []byte("login:alice@example.com|password:hunter2")
	items.seedItem(domainvault.Item{
		ID:            "I1",
		VaultID:       vaultID,
		ItemType:      domainvault.ItemTypeLogin,
		EncryptedData: aesGCMSeal(t, vaultKeyOld, plaintextI1),
		EncryptedName: aesGCMSeal(t, vaultKeyOld, []byte("alice-login")),
		CreatedAt:     time.Unix(testClockSec, 0).UTC(),
		UpdatedAt:     time.Unix(testClockSec, 0).UTC(),
	})

	// Sanity: A's cached vaultKeyOld decrypts I1 pre-rekey.
	stored, err := items.Get(ctx, vaultID, "I1")
	if err != nil {
		t.Fatalf("seed fetch: %v", err)
	}
	got, err := aesGCMOpen(vaultKeyOld, stored.EncryptedData)
	if err != nil || !bytes.Equal(got, plaintextI1) {
		t.Fatalf("pre-rekey decrypt broken: %v / %q", err, got)
	}

	// ========================================================================
	// Step 1: Admin B removes admin A.
	// ========================================================================
	removeUC := &RemoveMember{Vaults: vaults}
	out, err := removeUC.Execute(ctx, RemoveMemberInput{
		Caller:     "B",
		VaultID:    vaultID,
		TargetUser: "A",
	})
	if err != nil {
		t.Fatalf("RemoveMember: %v", err)
	}
	if !out.RekeyRequired {
		t.Fatalf("C2: RekeyRequired must be true after any removal")
	}
	// Remaining members list must not include A.
	for _, m := range out.RemainingMembers {
		if m.UserID == "A" {
			t.Fatalf("removed admin A still in remaining members: %+v", out.RemainingMembers)
		}
	}
	// A must no longer be an active member.
	if _, ok, _ := vaults.IsActiveMember(ctx, "A", vaultID); ok {
		t.Fatalf("A should not be an active member after removal")
	}

	// ========================================================================
	// Step 2: Admin B runs the rekey. Client generates vaultKeyNew, re-
	// encrypts I1 under it, and re-wraps it for B and C (NOT for A).
	// ========================================================================
	vaultKeyNew := newAESKey(t)
	if bytes.Equal(vaultKeyOld, vaultKeyNew) {
		t.Fatalf("new vault key must differ from old")
	}

	// Re-encrypt I1 under the new key.
	reblobI1Data := aesGCMSeal(t, vaultKeyNew, plaintextI1)
	reblobI1Name := aesGCMSeal(t, vaultKeyNew, []byte("alice-login"))

	rekeyUC := &RekeyVault{Vaults: vaults, Items: items}
	if err := rekeyUC.Execute(ctx, RekeyVaultInput{
		Caller:  "B",
		VaultID: vaultID,
		NewKeys: []RekeyBlob{
			{UserID: "B", EncryptedVaultKey: rsaBlobFor(0x22), WrapSignature: testEd25519Sig(t)},
			{UserID: "C", EncryptedVaultKey: rsaBlobFor(0x33), WrapSignature: testEd25519Sig(t)},
		},
		Items: []ItemReblob{
			{ItemID: "I1", EncryptedData: reblobI1Data, EncryptedName: reblobI1Name},
		},
	}); err != nil {
		t.Fatalf("RekeyVault.Execute: %v", err)
	}

	// ========================================================================
	// Step 3: Create I2 post-rekey, encrypted under vaultKeyNew.
	// ========================================================================
	plaintextI2 := []byte("login:bob@example.com|password:correcthorsebatterystaple")
	createUC := newCreateItem(vaults, items)
	createdI2, err := createUC.Execute(ctx, CreateItemInput{
		Caller:        "B",
		VaultID:       vaultID,
		ItemType:      domainvault.ItemTypeLogin,
		EncryptedData: aesGCMSeal(t, vaultKeyNew, plaintextI2),
		EncryptedName: aesGCMSeal(t, vaultKeyNew, []byte("bob-login")),
	})
	if err != nil {
		t.Fatalf("CreateItem I2: %v", err)
	}

	// ========================================================================
	// Assertion 1: A's cached vaultKeyOld MUST fail to decrypt I2.
	// This is the C2 "no read-only bypass" invariant.
	// ========================================================================
	storedI2, err := items.Get(ctx, vaultID, createdI2.ID)
	if err != nil {
		t.Fatalf("fetch I2: %v", err)
	}
	if _, err := aesGCMOpen(vaultKeyOld, storedI2.EncryptedData); err == nil {
		t.Fatalf("C2 VIOLATION: removed admin A's old vault key decrypted a post-rekey item")
	}

	// ========================================================================
	// Assertion 2: B's new key decrypts BOTH the re-encrypted I1 AND I2.
	// ========================================================================
	storedI1, err := items.Get(ctx, vaultID, "I1")
	if err != nil {
		t.Fatalf("fetch I1: %v", err)
	}
	roundI1, err := aesGCMOpen(vaultKeyNew, storedI1.EncryptedData)
	if err != nil || !bytes.Equal(roundI1, plaintextI1) {
		t.Fatalf("B should decrypt rekeyed I1: err=%v got=%q", err, roundI1)
	}
	roundI2, err := aesGCMOpen(vaultKeyNew, storedI2.EncryptedData)
	if err != nil || !bytes.Equal(roundI2, plaintextI2) {
		t.Fatalf("B should decrypt post-rekey I2: err=%v got=%q", err, roundI2)
	}

	// ========================================================================
	// Assertion 3: A's old key ALSO fails on the rekeyed I1 (the old
	// ciphertext has been replaced in storage).
	// ========================================================================
	if _, err := aesGCMOpen(vaultKeyOld, storedI1.EncryptedData); err == nil {
		t.Fatalf("C2 VIOLATION: old key decrypted the rekeyed I1 ciphertext")
	}
}

// TestRekey_CallerMustBeAdmin asserts the role gate on RekeyVault — a plain
// member cannot submit a rekey even if they're an active member of the vault.
func TestRekey_CallerMustBeAdmin(t *testing.T) {
	t.Parallel()

	vaults := newFakeVaultRepo()
	items := newFakeItemRepo()
	const vaultID = domainvault.ID("V")
	seedSharedVaultWithMembers(t, vaults, vaultID)

	uc := &RekeyVault{Vaults: vaults, Items: items}
	err := uc.Execute(context.Background(), RekeyVaultInput{
		Caller:  "C", // plain member
		VaultID: vaultID,
		NewKeys: []RekeyBlob{
			{UserID: "B", EncryptedVaultKey: rsaBlobFor(0x22), WrapSignature: testEd25519Sig(t)},
		},
	})
	if !errors.Is(err, ErrInsufficientRole) {
		t.Fatalf("expected ErrInsufficientRole, got %v", err)
	}
}

// TestRekey_RejectsMalformedBlob verifies that a rekey submission carrying
// a blob under the WRONG wrap algorithm (AES-256-KW in a shared vault) is
// rejected BEFORE any storage mutation. This is part of the C2 contract:
// the rekey is atomic — partial application would leave the vault in an
// unrecoverable state.
func TestRekey_RejectsMalformedBlob(t *testing.T) {
	t.Parallel()

	vaults := newFakeVaultRepo()
	items := newFakeItemRepo()
	ctx := context.Background()

	const vaultID = domainvault.ID("V")
	seedSharedVaultWithMembers(t, vaults, vaultID)

	// Seed a real item so we can detect accidental mutation.
	originalData := aesGCMSeal(t, newAESKey(t), []byte("original"))
	originalName := aesGCMSeal(t, newAESKey(t), []byte("orig-name"))
	items.seedItem(domainvault.Item{
		ID:            "I1",
		VaultID:       vaultID,
		ItemType:      domainvault.ItemTypeLogin,
		EncryptedData: originalData,
		EncryptedName: originalName,
	})

	// AES-256-KW blob — valid AES-KW shape, but WRONG for a shared vault
	// (which requires RSA-OAEP per domain.Member.Validate).
	kwBlob := crypto.EncryptedBlob{
		Version:    crypto.V1,
		Alg:        crypto.AlgAES256KW,
		Ciphertext: bytes.Repeat([]byte{0x42}, 32),
		Tag:        bytes.Repeat([]byte{0x01}, 8),
	}

	// Membership count snapshot so we can assert no rewraps happened.
	beforeMembers, _ := vaults.ListMembers(ctx, vaultID)

	uc := &RekeyVault{Vaults: vaults, Items: items}
	err := uc.Execute(ctx, RekeyVaultInput{
		Caller:  "B",
		VaultID: vaultID,
		NewKeys: []RekeyBlob{
			// First blob is fine — proves validation runs over the whole
			// slice before ANY persistence.
			{UserID: "B", EncryptedVaultKey: rsaBlobFor(0x22), WrapSignature: testEd25519Sig(t)},
			// Second blob is the poison.
			{UserID: "C", EncryptedVaultKey: kwBlob, WrapSignature: testEd25519Sig(t)},
		},
		Items: []ItemReblob{
			{ItemID: "I1", EncryptedData: aesGCMSeal(t, newAESKey(t), []byte("new")), EncryptedName: aesGCMSeal(t, newAESKey(t), []byte("n"))},
		},
	})
	if err == nil {
		t.Fatalf("expected validation error for wrong-algorithm blob")
	}
	if !strings.Contains(err.Error(), "rekey blob for C") {
		t.Fatalf("error should identify the bad blob, got %v", err)
	}

	// Item must be untouched.
	afterI1, err := items.Get(ctx, vaultID, "I1")
	if err != nil {
		t.Fatalf("fetch I1: %v", err)
	}
	if !bytes.Equal(afterI1.EncryptedData.Ciphertext, originalData.Ciphertext) {
		t.Fatalf("item was mutated despite validation failure")
	}
	if !bytes.Equal(afterI1.EncryptedName.Ciphertext, originalName.Ciphertext) {
		t.Fatalf("item name was mutated despite validation failure")
	}

	// Member rows must be untouched.
	afterMembers, _ := vaults.ListMembers(ctx, vaultID)
	if len(afterMembers) != len(beforeMembers) {
		t.Fatalf("member count changed: before=%d after=%d", len(beforeMembers), len(afterMembers))
	}
}

// TestRemoveMember_RefusesSelfRemoval is a regression guard for
// sharing.go:104 — an admin cannot remove themselves; they must transfer
// ownership first. This prevents accidental lockout of a single-admin vault.
func TestRemoveMember_RefusesSelfRemoval(t *testing.T) {
	t.Parallel()

	vaults := newFakeVaultRepo()
	const vaultID = domainvault.ID("V")
	seedSharedVaultWithMembers(t, vaults, vaultID)

	uc := &RemoveMember{Vaults: vaults}
	_, err := uc.Execute(context.Background(), RemoveMemberInput{
		Caller:     "A",
		VaultID:    vaultID,
		TargetUser: "A",
	})
	var inv *domain.Invalid
	if !errors.As(err, &inv) || inv.Field != "target_user" {
		t.Fatalf("expected invalid target_user, got %v", err)
	}

	// A must still be an active member.
	if _, ok, _ := vaults.IsActiveMember(context.Background(), "A", vaultID); !ok {
		t.Fatalf("A was removed despite self-removal being refused")
	}
}
