package auth

import (
	"context"
	"encoding/base64"
	"fmt"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// ===========================================================================
// CreateOrganization
// ===========================================================================

// CreateOrgInput carries the data needed to create a new organization.
type CreateOrgInput struct {
	Caller user.ID
	Name   string
}

// CreateOrganization creates a new org with the caller as owner.
type CreateOrganization struct {
	Orgs  ports.OrganizationRepository
	Clock ports.Clock
	IDs   ports.IDGenerator
}

// Execute creates the organization and the creator's owner membership.
func (uc *CreateOrganization) Execute(ctx context.Context, in CreateOrgInput) (organization.Organization, error) {
	if in.Caller.IsZero() {
		return organization.Organization{}, domain.NewInvalid("caller", "required")
	}
	if in.Name == "" {
		return organization.Organization{}, domain.NewInvalid("name", "required")
	}
	if len(in.Name) > organization.MaxNameLength {
		return organization.Organization{}, domain.NewInvalid("name", "too long")
	}

	now := uc.Clock.Now()
	org := organization.Organization{
		ID:        organization.ID(uc.IDs.NewID()),
		Name:      in.Name,
		CreatedBy: in.Caller,
		CreatedAt: now,
	}
	if err := org.Validate(); err != nil {
		return organization.Organization{}, err
	}

	creator := organization.Membership{
		OrgID:      org.ID,
		UserID:     in.Caller,
		Role:       user.RoleOwner,
		InvitedAt:  now,
		AcceptedAt: &now,
	}

	if err := uc.Orgs.Create(ctx, org, creator); err != nil {
		return organization.Organization{}, fmt.Errorf("persist organization: %w", err)
	}
	return org, nil
}

// ===========================================================================
// ListOrgMembers
// ===========================================================================

// ListOrgMembersInput identifies the org whose members to list.
type ListOrgMembersInput struct {
	Caller user.ID
	OrgID  organization.ID
}

// ListOrgMembers returns all members of an organization.
type ListOrgMembers struct {
	Orgs ports.OrganizationRepository
}

// Execute lists members.
func (uc *ListOrgMembers) Execute(ctx context.Context, in ListOrgMembersInput) ([]organization.Membership, error) {
	if in.OrgID.IsZero() {
		return nil, domain.NewInvalid("org_id", "required")
	}
	return uc.Orgs.ListMembers(ctx, in.OrgID)
}

// ===========================================================================
// UpdateOrgMemberRole
// ===========================================================================

// UpdateOrgMemberRoleInput carries the data needed to update a member's role.
type UpdateOrgMemberRoleInput struct {
	Caller   user.ID
	OrgID    organization.ID
	TargetID user.ID
	Role     user.Role
}

// UpdateOrgMemberRole changes a member's org-level role.
type UpdateOrgMemberRole struct {
	Orgs ports.OrganizationRepository
}

// Execute updates the role.
func (uc *UpdateOrgMemberRole) Execute(ctx context.Context, in UpdateOrgMemberRoleInput) error {
	if in.OrgID.IsZero() {
		return domain.NewInvalid("org_id", "required")
	}
	if in.TargetID.IsZero() {
		return domain.NewInvalid("user_id", "required")
	}
	if !in.Role.IsValid() {
		return domain.NewInvalid("role", "invalid")
	}
	return uc.Orgs.UpdateMemberRole(ctx, in.OrgID, in.TargetID, in.Role)
}

// ===========================================================================
// ExportVaults
// ===========================================================================

// ExportVaultInput carries the caller identity for the export.
type ExportVaultInput struct {
	Caller user.ID
}

// ExportData is the full data export for a user.
type ExportData struct {
	Vaults  []ExportVault  `json:"vaults"`
	Items   []ExportItem   `json:"items"`
	Folders []ExportFolder `json:"folders"`
}

// ExportVault is a single vault in the export payload.
type ExportVault struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	CreatedAt string `json:"createdAt"`
}

// ExportItem is a single item in the export payload.
type ExportItem struct {
	ID            string  `json:"id"`
	VaultID       string  `json:"vaultId"`
	FolderID      *string `json:"folderId,omitempty"`
	ItemType      string  `json:"itemType"`
	EncryptedData string  `json:"encryptedData"`
	EncryptedName string  `json:"encryptedName"`
	Favorite      bool    `json:"favorite"`
	CreatedAt     string  `json:"createdAt"`
	UpdatedAt     string  `json:"updatedAt"`
}

// ExportFolder is a single folder in the export payload.
type ExportFolder struct {
	ID            string `json:"id"`
	VaultID       string `json:"vaultId"`
	EncryptedName string `json:"encryptedName"`
	CreatedAt     string `json:"createdAt"`
}

// ExportVaults loads all vaults, items, and folders for a user.
type ExportVaults struct {
	Vaults  ports.VaultRepository
	Items   ports.ItemRepository
	Folders ports.FolderRepository
}

const exportTimeFormat = "2006-01-02T15:04:05Z"

// Execute performs the export.
func (uc *ExportVaults) Execute(ctx context.Context, in ExportVaultInput) (ExportData, error) {
	if in.Caller.IsZero() {
		return ExportData{}, domain.NewInvalid("caller", "required")
	}

	vaults, err := uc.Vaults.ListForUser(ctx, in.Caller)
	if err != nil {
		return ExportData{}, fmt.Errorf("list vaults: %w", err)
	}

	var data ExportData
	for _, v := range vaults {
		data.Vaults = append(data.Vaults, ExportVault{
			ID:        string(v.ID),
			Name:      v.Name,
			Type:      string(v.Type),
			CreatedAt: v.CreatedAt.UTC().Format(exportTimeFormat),
		})

		// Load all active items for this vault
		items, err := uc.Items.ListActive(ctx, v.ID, ports.ItemListOptions{})
		if err != nil {
			return ExportData{}, fmt.Errorf("list items for vault %s: %w", v.ID, err)
		}
		for _, it := range items {
			var folderID *string
			if it.FolderID != nil {
				s := string(*it.FolderID)
				folderID = &s
			}
			data.Items = append(data.Items, ExportItem{
				ID:            string(it.ID),
				VaultID:       string(it.VaultID),
				FolderID:      folderID,
				ItemType:      string(it.ItemType),
				EncryptedData: encodeB64Blob(it.EncryptedData),
				EncryptedName: encodeB64Blob(it.EncryptedName),
				Favorite:      it.Favorite,
				CreatedAt:     it.CreatedAt.UTC().Format(exportTimeFormat),
				UpdatedAt:     it.UpdatedAt.UTC().Format(exportTimeFormat),
			})
		}

		// Load all folders for this vault
		folders, err := uc.Folders.List(ctx, v.ID)
		if err != nil {
			return ExportData{}, fmt.Errorf("list folders for vault %s: %w", v.ID, err)
		}
		for _, f := range folders {
			data.Folders = append(data.Folders, ExportFolder{
				ID:            string(f.ID),
				VaultID:       string(f.VaultID),
				EncryptedName: encodeB64Blob(f.EncryptedName),
				CreatedAt:     f.CreatedAt.UTC().Format(exportTimeFormat),
			})
		}
	}

	// Ensure non-nil slices in JSON output
	if data.Vaults == nil {
		data.Vaults = []ExportVault{}
	}
	if data.Items == nil {
		data.Items = []ExportItem{}
	}
	if data.Folders == nil {
		data.Folders = []ExportFolder{}
	}

	return data, nil
}

// encodeB64Blob encodes an EncryptedBlob to base64 for export.
func encodeB64Blob(b crypto.EncryptedBlob) string {
	if b.Version == 0 {
		return ""
	}
	return base64.StdEncoding.EncodeToString(b.Bytes())
}
