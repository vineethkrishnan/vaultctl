package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/vineethkrishnan/vaultctl/internal/application/audit"
	"github.com/vineethkrishnan/vaultctl/internal/application/auth"
	appvault "github.com/vineethkrishnan/vaultctl/internal/application/vault"
	"github.com/vineethkrishnan/vaultctl/internal/domain/organization"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// OrgHandlers ties HTTP to the organization use cases.
type OrgHandlers struct {
	CreateOrg        *auth.CreateOrganization
	ListMembers      *auth.ListOrgMembers
	UpdateMemberRole *auth.UpdateOrgMemberRole
	RemoveMember     *auth.RemoveOrgMember

	// Audit is the cross-cutting audit-log writer (M13).
	Audit *audit.Writer
}

// HandleCreateOrg creates a new organization.
// @Summary Create organization
// @Description Admin creates a new organization
// @Tags Organizations
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreateOrgRequest true "Organization payload"
// @Success 201 {object} OrgResponse
// @Failure 400 {object} ErrorBody
// @Failure 401 {object} ErrorBody
// @Failure 403 {object} ErrorBody
// @Router /orgs [post]
func (h *OrgHandlers) HandleCreateOrg(w http.ResponseWriter, r *http.Request) {
	var req CreateOrgRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}

	callerID := middleware.CallerID(r.Context())
	org, err := h.CreateOrg.Execute(r.Context(), auth.CreateOrgInput{
		Caller: callerID,
		Name:   req.Name,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.OrgCreated(r.Context(), string(callerID), string(org.ID), middleware.ClientIP(r), r.UserAgent())

	writeJSON(w, http.StatusCreated, OrgResponse{
		ID:        string(org.ID),
		Name:      org.Name,
		CreatedBy: string(org.CreatedBy),
		CreatedAt: org.CreatedAt.UTC().Format(timeFormat),
	})
}

// HandleListOrgMembers returns all members of an organization.
// @Summary List org members
// @Description List all members of an organization
// @Tags Organizations
// @Produce json
// @Security BearerAuth
// @Param id path string true "Organization ID"
// @Success 200 {array} OrgMemberResponse
// @Failure 401 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /orgs/{id}/members [get]
func (h *OrgHandlers) HandleListOrgMembers(w http.ResponseWriter, r *http.Request) {
	orgID := organization.ID(chi.URLParam(r, "id"))
	callerID := middleware.CallerID(r.Context())

	members, err := h.ListMembers.Execute(r.Context(), auth.ListOrgMembersInput{
		Caller: callerID,
		OrgID:  orgID,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	dtos := make([]OrgMemberResponse, 0, len(members))
	for _, m := range members {
		dto := OrgMemberResponse{
			OrgID:     string(m.OrgID),
			UserID:    string(m.UserID),
			Role:      string(m.Role),
			InvitedAt: m.InvitedAt.UTC().Format(timeFormat),
		}
		if m.AcceptedAt != nil {
			s := m.AcceptedAt.UTC().Format(timeFormat)
			dto.AcceptedAt = &s
		}
		dtos = append(dtos, dto)
	}

	writeJSON(w, http.StatusOK, dtos)
}

// HandleUpdateMemberRole updates a member's org-level role.
// @Summary Update member role
// @Description Update a member's role within an organization
// @Tags Organizations
// @Accept json
// @Security BearerAuth
// @Param id path string true "Organization ID"
// @Param userId path string true "User ID"
// @Param body body UpdateMemberRoleRequest true "New role"
// @Success 204 "No content"
// @Failure 400 {object} ErrorBody
// @Failure 401 {object} ErrorBody
// @Failure 403 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /orgs/{id}/members/{userId} [put]
func (h *OrgHandlers) HandleUpdateMemberRole(w http.ResponseWriter, r *http.Request) {
	var req UpdateMemberRoleRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}

	role, err := user.ParseRole(req.Role)
	if err != nil {
		writeError(w, r, err)
		return
	}

	callerID := middleware.CallerID(r.Context())
	orgID := organization.ID(chi.URLParam(r, "id"))
	targetID := user.ID(chi.URLParam(r, "userId"))

	err = h.UpdateMemberRole.Execute(r.Context(), auth.UpdateOrgMemberRoleInput{
		Caller:   callerID,
		OrgID:    orgID,
		TargetID: targetID,
		Role:     role,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.OrgRoleChanged(r.Context(), string(callerID), string(orgID), string(targetID), middleware.ClientIP(r), r.UserAgent())

	w.WriteHeader(http.StatusNoContent)
}

// HandleRemoveOrgMember removes a member from an organization and cascades
// the removal into every shared vault membership the user held (C2).
// @Summary Remove org member
// @Description Remove a user from the organization. Cascades into shared-vault memberships and triggers an unconditional client-driven rekey of every affected vault.
// @Tags Organizations
// @Produce json
// @Security BearerAuth
// @Param id path string true "Organization ID"
// @Param userId path string true "User ID to remove"
// @Success 200 {object} RemoveOrgMemberResponse
// @Failure 400 {object} ErrorBody
// @Failure 401 {object} ErrorBody
// @Failure 403 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /orgs/{id}/members/{userId} [delete]
func (h *OrgHandlers) HandleRemoveOrgMember(w http.ResponseWriter, r *http.Request) {
	callerID := middleware.CallerID(r.Context())
	orgID := organization.ID(chi.URLParam(r, "id"))
	targetID := user.ID(chi.URLParam(r, "userId"))

	out, err := h.RemoveMember.Execute(r.Context(), auth.RemoveOrgMemberInput{
		Caller:   callerID,
		OrgID:    orgID,
		TargetID: targetID,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.Audit.OrgMemberRemoved(r.Context(), string(callerID), string(orgID), string(targetID), middleware.ClientIP(r), r.UserAgent())

	affected := make([]string, 0, len(out.AffectedVaults))
	for _, vid := range out.AffectedVaults {
		affected = append(affected, string(vid))
	}
	writeJSON(w, http.StatusOK, RemoveOrgMemberResponse{
		RekeyJobID:     out.RekeyJobID,
		AffectedVaults: affected,
	})
}

// ===========================================================================
// Admin handlers
// ===========================================================================

// AdminHandlers ties HTTP to admin-only operations.
type AdminHandlers struct {
	ListBackups *auth.ListBackups
}

// HandleBackup returns 501 Not Implemented, directing users to the CLI.
// @Summary Trigger backup
// @Description Backup requires pg_dump (shell access) and is not suitable for HTTP API. Use the CLI instead.
// @Tags Admin
// @Security BearerAuth
// @Failure 501 {object} ErrorBody "Not implemented — use CLI"
// @Router /admin/backup [post]
func (h *AdminHandlers) HandleBackup(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{
		"error":   "not_implemented",
		"message": "backup requires shell access (pg_dump); use `vaultctl backup` CLI command instead",
	})
}

// HandleListBackups returns available backup files.
// @Summary List backups
// @Description List available backup files with size and creation time. Admin only.
// @Tags Admin
// @Produce json
// @Security BearerAuth
// @Success 200 {object} ListBackupsResponse
// @Failure 401 {object} ErrorBody
// @Failure 403 {object} ErrorBody "Admin required"
// @Router /admin/backups [get]
func (h *AdminHandlers) HandleListBackups(w http.ResponseWriter, r *http.Request) {
	out, err := h.ListBackups.Execute()
	if err != nil {
		writeError(w, r, err)
		return
	}

	backups := make([]BackupInfoDTO, 0, len(out.Backups))
	for _, b := range out.Backups {
		backups = append(backups, BackupInfoDTO{
			Filename:  b.Filename,
			Size:      b.Size,
			CreatedAt: b.CreatedAt.UTC().Format(timeFormat),
		})
	}
	writeJSON(w, http.StatusOK, ListBackupsResponse{Backups: backups})
}

// ===========================================================================
// Export handler
// ===========================================================================

// ExportHandlers ties HTTP to the data export use case.
type ExportHandlers struct {
	Export *auth.ExportVaults
}

// HandleExport exports all vault data for the authenticated user.
// @Summary Export vault data
// @Description Export all vaults, items, and folders for the authenticated user. Requires step-up authentication.
// @Tags Import/Export
// @Produce json
// @Security BearerAuth
// @Success 200 {object} auth.ExportData
// @Failure 401 {object} ErrorBody
// @Failure 403 {object} ErrorBody "Step-up required"
// @Router /export [get]
func (h *ExportHandlers) HandleExport(w http.ResponseWriter, r *http.Request) {
	callerID := middleware.CallerID(r.Context())

	data, err := h.Export.Execute(r.Context(), auth.ExportVaultInput{
		Caller: callerID,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, data)
}

// ===========================================================================
// Import handler
// ===========================================================================

// ImportHandlers ties HTTP to the import use case.
type ImportHandlers struct {
	Import *appvault.ImportItems
}

// HandleImport batch-creates vault items from an import payload.
// @Summary Import vault items
// @Description Batch-import encrypted items into a vault. Client performs format conversion and encryption.
// @Tags Import/Export
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body ImportRequest true "Import payload"
// @Success 200 {object} ImportResponse
// @Failure 400 {object} ErrorBody
// @Failure 401 {object} ErrorBody
// @Failure 404 {object} ErrorBody "Vault not found or not a member"
// @Router /import [post]
func (h *ImportHandlers) HandleImport(w http.ResponseWriter, r *http.Request) {
	var req ImportRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}

	items := make([]appvault.ImportedItem, 0, len(req.Items))
	for _, dto := range req.Items {
		data, err := decodeB64Blob(dto.EncryptedData)
		if err != nil {
			writeError(w, r, err)
			return
		}
		name, err := decodeB64Blob(dto.EncryptedName)
		if err != nil {
			writeError(w, r, err)
			return
		}
		var folderID *vault.FolderID
		if dto.FolderID != nil {
			v := vault.FolderID(*dto.FolderID)
			folderID = &v
		}
		items = append(items, appvault.ImportedItem{
			ItemType:      vault.ItemType(dto.ItemType),
			EncryptedData: data,
			EncryptedName: name,
			FolderID:      folderID,
		})
	}

	callerID := middleware.CallerID(r.Context())
	out, err := h.Import.Execute(r.Context(), appvault.ImportItemsInput{
		Caller:  callerID,
		VaultID: vault.ID(req.VaultID),
		Items:   items,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, ImportResponse{ImportedCount: out.ImportedCount})
}

// ===========================================================================
// Bulk trash purge handler
// ===========================================================================

// HandlePurgeExpiredTrash permanently deletes all expired trashed items in a vault.
// @Summary Purge expired trash
// @Description Permanently delete all trashed items older than 30 days in a vault. Requires step-up authentication.
// @Tags Trash
// @Produce json
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Success 200 {object} PurgeTrashResponse
// @Failure 401 {object} ErrorBody
// @Failure 403 {object} ErrorBody "Step-up required"
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/trash [delete]
func (h *VaultHandlers) HandlePurgeExpiredTrash(w http.ResponseWriter, r *http.Request) {
	callerID := middleware.CallerID(r.Context())
	vaultID := chi.URLParam(r, "vaultId")

	n, err := h.PurgeExpiredTrash.Execute(r.Context(), appvault.PurgeExpiredTrashInput{
		Caller:  string(callerID),
		VaultID: vaultID,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, PurgeTrashResponse{Purged: n})
}
