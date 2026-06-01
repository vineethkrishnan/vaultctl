// SPDX-License-Identifier: AGPL-3.0-or-later

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/vineethkrishnan/vaultctl/internal/application/audit"
	"github.com/vineethkrishnan/vaultctl/internal/application/auth"
	appbackup "github.com/vineethkrishnan/vaultctl/internal/application/backup"
	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	appvault "github.com/vineethkrishnan/vaultctl/internal/application/vault"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	infraauth "github.com/vineethkrishnan/vaultctl/internal/infrastructure/auth"
	infrabackup "github.com/vineethkrishnan/vaultctl/internal/infrastructure/backup"
	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/blobstore"
	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/config"
	infracrypto "github.com/vineethkrishnan/vaultctl/internal/infrastructure/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/postgres"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// adapters bundles every concrete adapter so main.go can wire handlers in
// one shot.
type adapters struct {
	pool    *postgres.Pool
	users   *postgres.UserRepo
	sess    *postgres.SessionStore
	vaults  *postgres.VaultRepo
	items   *postgres.ItemRepo
	folders *postgres.FolderRepo
	apikeys *postgres.APIKeyRepo
	invites *postgres.InviteRepo
	orgs    *postgres.OrgRepo
	audit   *postgres.AuditRepo
	attach  *postgres.AttachmentRepo
	blobs   ports.BlobStore // nil when the blob store is unavailable

	backupDests  *postgres.BackupDestinationRepo // nil when backup sync is off
	backupRuns   *postgres.BackupRunRepo
	backupStores *infrabackup.StoreFactory
	backupRun    *appbackup.RunBackup // set in buildHandlers, read by main for the scheduler

	hasher *infraauth.Argon2Hasher
	hmac   *infraauth.HMACService
	jwt    *infraauth.JWTService
	tokens *infraauth.TokenGenerator
	totp   *infraauth.TOTPProvider
	aead   *infracrypto.ServerAEAD

	clock ports.Clock
	ids   ports.IDGenerator

	rateLimiter *middleware.RateLimiter
}

// uuidGen implements ports.IDGenerator.
type uuidGen struct{}

func (uuidGen) NewID() string { return uuid.NewString() }

// buildAdapters opens every infrastructure dependency.
func buildAdapters(ctx context.Context, cfg *config.Config) (*adapters, error) {
	pool, err := postgres.Connect(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("postgres: %w", err)
	}
	hmac, err := infraauth.NewHMACService(cfg.ServerPepper, cfg.EnumerationPepper)
	if err != nil {
		return nil, fmt.Errorf("hmac: %w", err)
	}
	var nextKey *infraauth.JWTKey
	if cfg.JWTSecretNext != "" {
		k := infraauth.JWTKey{Kid: cfg.JWTKidCurrent + "-next", Secret: []byte(cfg.JWTSecretNext)}
		nextKey = &k
	}
	jwt, err := infraauth.NewJWTService(infraauth.JWTConfig{
		Current:   infraauth.JWTKey{Kid: cfg.JWTKidCurrent, Secret: []byte(cfg.JWTSecretCurrent)},
		Next:      nextKey,
		Issuer:    "vaultctl",
		AccessTTL: cfg.JWTAccessTTL,
	})
	if err != nil {
		return nil, fmt.Errorf("jwt: %w", err)
	}

	clock := ports.RealClock()

	var aead *infracrypto.ServerAEAD
	if cfg.DataEncryptionKey != "" {
		var err2 error
		aead, err2 = infracrypto.NewServerAEAD(cfg.DataEncryptionKey, cfg.DataEncryptionKeyNext)
		if err2 != nil {
			return nil, fmt.Errorf("server aead: %w", err2)
		}
	}

	a := &adapters{
		pool:    pool,
		users:   &postgres.UserRepo{Pool: pool},
		sess:    &postgres.SessionStore{Pool: pool},
		vaults:  &postgres.VaultRepo{Pool: pool},
		items:   &postgres.ItemRepo{Pool: pool},
		folders: &postgres.FolderRepo{Pool: pool},
		apikeys: &postgres.APIKeyRepo{Pool: pool},
		invites: &postgres.InviteRepo{Pool: pool},
		orgs:    &postgres.OrgRepo{Pool: pool},
		audit:   &postgres.AuditRepo{Pool: pool},
		attach:  &postgres.AttachmentRepo{Pool: pool},
		hasher:  infraauth.NewArgon2Hasher(infraauth.DefaultServerArgon2Params()),
		hmac:    hmac,
		jwt:     jwt,
		tokens:  infraauth.NewTokenGenerator(),
		totp:    infraauth.NewTOTPProvider(),
		aead:    aead,
		clock:   clock,
		ids:     uuidGen{},
		rateLimiter: middleware.NewRateLimiter(
			clock, cfg.RateLimitRPM, time.Minute,
			cfg.AuthRateLimitPerEmail, cfg.AuthRateLimitWindow,
		),
	}

	// Attachments are optional: if the blob store can't be opened (e.g. the
	// volume isn't writable), the server still runs and attachment endpoints
	// are simply not registered.
	if store, berr := blobstore.NewFSStore(cfg.AttachmentsDir); berr != nil {
		slog.Warn("attachments disabled: blob store unavailable", "dir", cfg.AttachmentsDir, "err", berr)
	} else {
		a.blobs = store
	}

	// Backup sync needs the server data key to seal artifacts + provider
	// credentials at rest. Without it (or when disabled) the feature is off
	// and its endpoints are never registered.
	if cfg.BackupSyncEnabled && aead != nil {
		a.backupDests = &postgres.BackupDestinationRepo{Pool: pool, Sealer: aead}
		a.backupRuns = &postgres.BackupRunRepo{Pool: pool}
		a.backupStores = &infrabackup.StoreFactory{LocalBaseDir: cfg.BackupLocalDir}
	} else if !cfg.BackupSyncEnabled {
		slog.Info("backup sync disabled by config")
	} else {
		slog.Warn("backup sync disabled: VAULTCTL_DATA_ENCRYPTION_KEY is required to seal artifacts")
	}

	return a, nil
}

// backupProviders reports which destinations this server can use. Local is
// always available; cloud providers require their OAuth client credentials.
func backupProviders(cfg *config.Config) []string {
	providers := []string{"local"}
	if cfg.BackupGoogleClientID != "" {
		providers = append(providers, "gdrive")
	}
	if cfg.BackupDropboxClientID != "" {
		providers = append(providers, "dropbox")
	}
	if cfg.BackupOneDriveClientID != "" {
		providers = append(providers, "onedrive")
	}
	return providers
}

// exporterAdapter bridges the ExportVaults use case into ports.Exporter,
// serialising the (client-encrypted) export to JSON bytes for sealing.
type exporterAdapter struct {
	uc *auth.ExportVaults
}

func (e *exporterAdapter) ExportEncrypted(ctx context.Context, userID string) ([]byte, error) {
	data, err := e.uc.Execute(ctx, auth.ExportVaultInput{Caller: user.ID(userID)})
	if err != nil {
		return nil, err
	}
	return json.Marshal(data)
}

// buildHandlers constructs the use cases + API handler structs.
func buildHandlers(cfg *config.Config, a *adapters) (api.Dependencies, error) {
	tokens := &jwtServiceAdapter{svc: a.jwt}

	trustedProxies, err := middleware.ParseTrustedProxies(cfg.TrustedProxies)
	if err != nil {
		return api.Dependencies{}, fmt.Errorf("trusted proxies: %w", err)
	}

	// Audit writer (M13): cross-cutting side-effect sink. All handlers
	// that mutate state share the same instance so a single INSERT path
	// feeds every action.
	auditWriter := audit.New(a.audit, a.clock, slog.Default())

	authHandlers := &api.AuthHandlers{
		Users: a.users,
		Audit: auditWriter,
		Register: &auth.Register{
			Users: a.users, Hasher: a.hasher, Clock: a.clock, IDs: a.ids,
			Encrypter: a.aead,
			Policy:    user.DefaultPolicy(), DefaultRole: user.RoleMember,
			RegistrationMode: cfg.RegistrationMode,
			RedeemInvite: &auth.RedeemInvite{
				Invites: a.invites, HMAC: a.hmac, Clock: a.clock,
			},
		},
		Prelogin: &auth.Prelogin{Users: a.users, HMAC: a.hmac, DefaultKDF: user.DefaultKDFParams()},
		Login: &auth.Login{
			Users: a.users, Sessions: a.sess, Vaults: a.vaults,
			Hasher: a.hasher, Tokens: tokens, TokenGenerator: a.tokens,
			HMAC: a.hmac, Clock: a.clock, IDs: a.ids,
			MaxAttempts:     cfg.MaxLoginAttempts,
			LockoutDuration: cfg.LockoutDuration,
			RefreshTTL:      cfg.JWTRefreshTTL,
		},
		Refresh: &auth.Refresh{
			Users: a.users, Sessions: a.sess, Tokens: tokens,
			TokenGenerator: a.tokens, HMAC: a.hmac, Clock: a.clock,
			RefreshTTL: cfg.JWTRefreshTTL,
		},
		Logout: &auth.Logout{Sessions: a.sess, HMAC: a.hmac},
		StepUp: &auth.StepUp{
			Users: a.users, Hasher: a.hasher, Tokens: tokens,
			Clock: a.clock, StepUpTTL: 5 * time.Minute,
		},
		PasswordChange: &auth.PasswordChange{
			Users: a.users, Sessions: a.sess, Hasher: a.hasher,
			Tokens: tokens, TokenGenerator: a.tokens, HMAC: a.hmac,
			Clock: a.clock, IDs: a.ids, RefreshTTL: cfg.JWTRefreshTTL,
		},
		TOTPSetup:         &auth.TOTPSetup{Users: a.users, TOTP: a.totp, Encrypter: a.aead, Issuer: "vaultctl"},
		TOTPEnable:        &auth.TOTPEnable{Users: a.users, TOTP: a.totp, Encrypter: a.aead, Clock: a.clock},
		TOTPDisable:       &auth.TOTPDisable{Users: a.users},
		TOTPVerify:        &auth.TOTPVerify{Users: a.users, TOTP: a.totp, Encrypter: a.aead, Clock: a.clock},
		GetPasswordHint:   &auth.GetPasswordHint{Users: a.users, Encrypter: a.aead},
		VerifyRecoveryKey: &auth.VerifyRecoveryKey{Users: a.users},
		ResetViaRecovery: &auth.ResetViaRecovery{
			Users: a.users, Sessions: a.sess, Hasher: a.hasher,
			Tokens: tokens, TokenGenerator: a.tokens, HMAC: a.hmac,
			Clock: a.clock, IDs: a.ids, RefreshTTL: cfg.JWTRefreshTTL,
		},
	}

	userHandlers := &api.UserHandlers{
		Users:    a.users,
		Sessions: a.sess,
		Audit:    auditWriter,
	}

	apiKeyHandlers := &api.APIKeyHandlers{
		Create: &auth.CreateAPIKey{
			APIKeys: a.apikeys, TokenGenerator: a.tokens,
			HMAC: a.hmac, Clock: a.clock, IDs: a.ids,
		},
		List:   &auth.ListAPIKeys{APIKeys: a.apikeys},
		Delete: &auth.DeleteAPIKey{APIKeys: a.apikeys},
		Audit:  auditWriter,
	}

	inviteHandlers := &api.InviteHandlers{
		CreateInvite: &auth.CreateInvite{
			Invites: a.invites, HMAC: a.hmac, Tokens: a.tokens,
			Clock: a.clock, IDs: a.ids,
		},
		RedeemInvite: &auth.RedeemInvite{
			Invites: a.invites, HMAC: a.hmac, Clock: a.clock,
		},
		RevokeInvite: &auth.RevokeInvite{
			Invites: a.invites, Clock: a.clock,
		},
		ListInvites: &auth.ListInvites{Invites: a.invites},
		Audit:       auditWriter,
	}

	vaultHandlers := &api.VaultHandlers{
		ListVaults:  &appvault.ListVaults{Vaults: a.vaults},
		CreateVault: &appvault.CreateVault{Vaults: a.vaults, Clock: a.clock, IDs: a.ids},
		CreateItem:  &appvault.CreateItem{Vaults: a.vaults, Items: a.items, Clock: a.clock, IDs: a.ids},
		GetItem:     &appvault.GetItem{Vaults: a.vaults, Items: a.items},
		UpdateItem:  &appvault.UpdateItem{Vaults: a.vaults, Items: a.items, Clock: a.clock},
		TrashItem:   &appvault.TrashItem{Vaults: a.vaults, Items: a.items, Clock: a.clock},
		RestoreItem: &appvault.RestoreItem{Vaults: a.vaults, Items: a.items, Clock: a.clock},
		PurgeItem:   &appvault.PurgeItem{Vaults: a.vaults, Items: a.items, Attachments: a.attach, Blobs: a.blobs},
		PurgeExpiredTrash: &appvault.PurgeExpiredTrashInVault{
			Vaults: a.vaults, Items: a.items, Clock: a.clock,
			RetentionDays: cfg.TrashRetentionDays,
		},
		ListActive:   &appvault.ListActive{Vaults: a.vaults, Items: a.items},
		ListTrash:    &appvault.ListTrash{Vaults: a.vaults, Items: a.items},
		CreateFolder: &appvault.CreateFolder{Vaults: a.vaults, Folders: a.folders, Clock: a.clock, IDs: a.ids},
		RenameFolder: &appvault.RenameFolder{Vaults: a.vaults, Folders: a.folders},
		DeleteFolder: &appvault.DeleteFolder{Vaults: a.vaults, Folders: a.folders},
		ListFolders:  &appvault.ListFolders{Vaults: a.vaults, Folders: a.folders},
		ShareVault:   &appvault.ShareVault{Vaults: a.vaults, Clock: a.clock},
		RemoveMember: &appvault.RemoveMember{Vaults: a.vaults},
		RekeyVault:   &appvault.RekeyVault{Vaults: a.vaults, Items: a.items},
		Audit:        auditWriter,
	}

	orgHandlers := &api.OrgHandlers{
		CreateOrg:        &auth.CreateOrganization{Orgs: a.orgs, Clock: a.clock, IDs: a.ids},
		ListMembers:      &auth.ListOrgMembers{Orgs: a.orgs},
		UpdateMemberRole: &auth.UpdateOrgMemberRole{Orgs: a.orgs},
		RemoveMember: &auth.RemoveOrgMember{
			Orgs: a.orgs, Vaults: a.vaults, IDs: a.ids,
		},
		Audit: auditWriter,
	}

	exportVaults := &auth.ExportVaults{
		Vaults: a.vaults, Items: a.items, Folders: a.folders,
	}
	exportHandlers := &api.ExportHandlers{Export: exportVaults}

	// Per-user backup destinations (sync). Only wired when sealing is available.
	var backupHandlers *api.BackupHandlers
	if a.backupDests != nil {
		exporter := &exporterAdapter{uc: exportVaults}
		a.backupRun = &appbackup.RunBackup{
			Destinations: a.backupDests, Runs: a.backupRuns, Stores: a.backupStores,
			Exporter: exporter, Sealer: a.aead, Clock: a.clock, IDs: a.ids,
		}
		backupHandlers = &api.BackupHandlers{
			Configure:     &appbackup.ConfigureDestination{Destinations: a.backupDests, Clock: a.clock, IDs: a.ids},
			List:          &appbackup.ListDestinations{Destinations: a.backupDests},
			Delete:        &appbackup.DeleteDestination{Destinations: a.backupDests},
			Run:           a.backupRun,
			ListRuns:      &appbackup.ListRuns{Destinations: a.backupDests, Runs: a.backupRuns},
			ListArtifacts: &appbackup.ListArtifacts{Destinations: a.backupDests, Stores: a.backupStores},
			Restore:       &appbackup.Restore{Destinations: a.backupDests, Stores: a.backupStores, Sealer: a.aead},
			Available:     backupProviders(cfg),
			Audit:         auditWriter,
		}
	}

	apiKeyValidator := &apiKeyValidatorAdapter{
		uc:    &auth.ValidateAPIKey{APIKeys: a.apikeys, HMAC: a.hmac, Clock: a.clock},
		Users: a.users,
	}

	// Attachment handlers are only wired when the blob store is available.
	var attachmentHandlers *api.AttachmentHandlers
	if a.blobs != nil {
		attachmentHandlers = &api.AttachmentHandlers{
			Create: &appvault.CreateAttachment{
				Vaults: a.vaults, Items: a.items, Attachments: a.attach, Blobs: a.blobs,
				Clock: a.clock, IDs: a.ids,
				MaxBytes: cfg.AttachmentMaxBytes, VaultQuotaBytes: cfg.AttachmentVaultQuota,
			},
			List:     &appvault.ListAttachments{Vaults: a.vaults, Attachments: a.attach},
			Get:      &appvault.GetAttachment{Vaults: a.vaults, Attachments: a.attach, Blobs: a.blobs},
			Delete:   &appvault.DeleteAttachment{Vaults: a.vaults, Attachments: a.attach, Blobs: a.blobs},
			MaxBytes: cfg.AttachmentMaxBytes,
		}
	}

	return api.Dependencies{
		Tokens:     tokens,
		Clock:      a.clock,
		Auth:       authHandlers,
		User:       userHandlers,
		Vault:      vaultHandlers,
		Attachment: attachmentHandlers,
		APIKey:     apiKeyHandlers,
		Invite:     inviteHandlers,
		Org:        orgHandlers,
		Admin: &api.AdminHandlers{
			ListBackups: &auth.ListBackups{BackupDir: "/backups"},
		},
		Export: exportHandlers,
		Backup: backupHandlers,
		Import: &api.ImportHandlers{
			Import: &appvault.ImportItems{
				Vaults: a.vaults, Items: a.items, Clock: a.clock, IDs: a.ids,
			},
		},
		APIKeyValidator:    apiKeyValidator,
		RateLimiter:        a.rateLimiter,
		TrustedProxies:     trustedProxies,
		CORSAllowedOrigins: cfg.CORSAllowedOrigins,
		RegistrationMode:   cfg.RegistrationMode,
		Env:                string(cfg.Env),
	}, nil
}

// jwtServiceAdapter bridges the infrastructure JWTService into the
// ports.TokenIssuer interface (different struct types, same semantics).
type jwtServiceAdapter struct {
	svc *infraauth.JWTService
}

func (a *jwtServiceAdapter) Issue(userID, role string, now, stepUpUntil time.Time) (string, error) {
	return a.svc.Issue(userID, role, now, stepUpUntil)
}
func (a *jwtServiceAdapter) Verify(token string) (ports.AccessClaims, error) {
	claims, err := a.svc.Verify(token)
	if err != nil {
		return ports.AccessClaims{}, err
	}
	out := ports.AccessClaims{UserID: claims.UserID, Role: claims.Role}
	if claims.StepUpExp > 0 {
		out.StepUpUntil = time.Unix(claims.StepUpExp, 0)
	}
	return out, nil
}

// apiKeyValidatorAdapter bridges the ValidateAPIKey use case into the
// middleware.APIKeyValidator interface.
type apiKeyValidatorAdapter struct {
	uc    *auth.ValidateAPIKey
	Users ports.UserRepository
}

func (a *apiKeyValidatorAdapter) Validate(ctx context.Context, rawKey string) (string, string, error) {
	out, err := a.uc.Execute(ctx, auth.ValidateAPIKeyInput{RawKey: rawKey})
	if err != nil {
		return "", "", err
	}

	// Look up the user to get their current role and verify they still exist.
	u, err := a.Users.FindByID(ctx, out.UserID)
	if err != nil {
		return "", "", err
	}

	return string(out.UserID), string(u.Role), nil
}
