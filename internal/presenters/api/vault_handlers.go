package api

import (
	"encoding/base64"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	appvault "github.com/vineethkrishnan/vaultctl/internal/application/vault"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// VaultHandlers ties HTTP to the vault use cases.
type VaultHandlers struct {
	ListVaults        *appvault.ListVaults
	CreateVault       *appvault.CreateVault
	CreateItem        *appvault.CreateItem
	GetItem           *appvault.GetItem
	UpdateItem        *appvault.UpdateItem
	TrashItem         *appvault.TrashItem
	RestoreItem       *appvault.RestoreItem
	PurgeItem         *appvault.PurgeItem
	ListActive        *appvault.ListActive
	ListTrash         *appvault.ListTrash
	CreateFolder      *appvault.CreateFolder
	RenameFolder      *appvault.RenameFolder
	DeleteFolder      *appvault.DeleteFolder
	ListFolders       *appvault.ListFolders
	ShareVault        *appvault.ShareVault
	RemoveMember      *appvault.RemoveMember
	RekeyVault        *appvault.RekeyVault
}

// HandleListVaults returns all vaults the caller is a member of.
// @Summary List vaults
// @Description Returns all vaults the authenticated user has access to
// @Tags Vaults
// @Produce json
// @Security BearerAuth
// @Success 200 {array} VaultResponse
// @Failure 401 {object} ErrorBody
// @Router /vaults [get]
func (h *VaultHandlers) HandleListVaults(w http.ResponseWriter, r *http.Request) {
	results, err := h.ListVaults.Execute(r.Context(), appvault.ListVaultsInput{
		Caller: middleware.CallerID(r.Context()),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]VaultResponse, 0, len(results))
	for _, vm := range results {
		out = append(out, VaultResponse{
			ID:                string(vm.Vault.ID),
			Name:              vm.Vault.Name,
			Type:              string(vm.Vault.Type),
			Role:              string(vm.Member.Role),
			EncryptedVaultKey: encodeB64Blob(vm.Member.EncryptedVaultKey),
			SenderID:          string(vm.Member.SenderID),
			WrapSignature:     encodeB64(vm.Member.WrapSignature.Bytes()),
			CreatedAt:         vm.Vault.CreatedAt.UTC().Format(timeFormat),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// HandleCreateVault creates a new vault.
// @Summary Create vault
// @Description Create a new vault with an encrypted vault key
// @Tags Vaults
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body VaultCreateRequest true "Vault creation payload"
// @Success 201 {object} VaultResponse
// @Failure 400 {object} ErrorBody
// @Failure 401 {object} ErrorBody
// @Router /vaults [post]
func (h *VaultHandlers) HandleCreateVault(w http.ResponseWriter, r *http.Request) {
	var req VaultCreateRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	encKey, err := decodeB64Blob(req.EncryptedVaultKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	sigRaw, err := base64.StdEncoding.DecodeString(req.WrapSignature)
	if err != nil {
		writeError(w, r, err)
		return
	}
	sig, err := crypto.NewEd25519Signature(sigRaw)
	if err != nil {
		writeError(w, r, err)
		return
	}
	vm, err := h.CreateVault.Execute(r.Context(), appvault.CreateVaultInput{
		Caller:            middleware.CallerID(r.Context()),
		Name:              req.Name,
		Type:              req.Type,
		EncryptedVaultKey: encKey,
		WrapSignature:     sig,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, VaultResponse{
		ID:                string(vm.Vault.ID),
		Name:              vm.Vault.Name,
		Type:              string(vm.Vault.Type),
		Role:              string(vm.Member.Role),
		EncryptedVaultKey: encodeB64Blob(vm.Member.EncryptedVaultKey),
		SenderID:          string(vm.Member.SenderID),
		WrapSignature:     encodeB64(vm.Member.WrapSignature.Bytes()),
		CreatedAt:         vm.Vault.CreatedAt.UTC().Format(timeFormat),
	})
}

// HandleCreateItem creates a new encrypted item in a vault.
// @Summary Create item
// @Description Create a new encrypted item in the specified vault
// @Tags Items
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param body body ItemCreateRequest true "Item payload"
// @Success 201 {object} ItemResponse
// @Failure 400 {object} ErrorBody
// @Failure 404 {object} ErrorBody "Vault not found or not a member"
// @Router /vaults/{vaultId}/items [post]
func (h *VaultHandlers) HandleCreateItem(w http.ResponseWriter, r *http.Request) {
	vaultID := vault.ID(chi.URLParam(r, "vaultId"))
	var req ItemCreateRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	data, err := decodeB64Blob(req.EncryptedData)
	if err != nil {
		writeError(w, r, err)
		return
	}
	name, err := decodeB64Blob(req.EncryptedName)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var folderID *vault.FolderID
	if req.FolderID != nil {
		v := vault.FolderID(*req.FolderID)
		folderID = &v
	}
	it, err := h.CreateItem.Execute(r.Context(), appvault.CreateItemInput{
		Caller: middleware.CallerID(r.Context()), VaultID: vaultID,
		FolderID: folderID, ItemType: vault.ItemType(req.ItemType),
		EncryptedData: data, EncryptedName: name,
		Favorite: req.Favorite, Reprompt: req.Reprompt,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, itemToDTO(it))
}

// HandleGetItem retrieves a single item.
// @Summary Get item
// @Description Retrieve a single encrypted item by ID
// @Tags Items
// @Produce json
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param id path string true "Item ID"
// @Success 200 {object} ItemResponse
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/items/{id} [get]
func (h *VaultHandlers) HandleGetItem(w http.ResponseWriter, r *http.Request) {
	it, err := h.GetItem.Execute(r.Context(), appvault.GetItemInput{
		Caller:  middleware.CallerID(r.Context()),
		VaultID: vault.ID(chi.URLParam(r, "vaultId")),
		ItemID:  vault.ItemID(chi.URLParam(r, "id")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, itemToDTO(it))
}

// HandleUpdateItem updates an existing item.
// @Summary Update item
// @Description Update an existing encrypted item
// @Tags Items
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param id path string true "Item ID"
// @Param body body ItemUpdateRequest true "Updated item payload"
// @Success 200 {object} ItemResponse
// @Failure 400 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/items/{id} [put]
func (h *VaultHandlers) HandleUpdateItem(w http.ResponseWriter, r *http.Request) {
	var req ItemUpdateRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	data, err := decodeB64Blob(req.EncryptedData)
	if err != nil {
		writeError(w, r, err)
		return
	}
	name, err := decodeB64Blob(req.EncryptedName)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var folderID *vault.FolderID
	if req.FolderID != nil {
		v := vault.FolderID(*req.FolderID)
		folderID = &v
	}
	it, err := h.UpdateItem.Execute(r.Context(), appvault.UpdateItemInput{
		Caller:  middleware.CallerID(r.Context()),
		VaultID: vault.ID(chi.URLParam(r, "vaultId")),
		ItemID:  vault.ItemID(chi.URLParam(r, "id")),
		FolderID: folderID, EncryptedData: data, EncryptedName: name,
		Favorite: req.Favorite, Reprompt: req.Reprompt,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, itemToDTO(it))
}

// HandleTrashItem soft-deletes an item.
// @Summary Trash item
// @Description Move an item to trash (soft delete)
// @Tags Items
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param id path string true "Item ID"
// @Success 204 "No content"
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/items/{id} [delete]
func (h *VaultHandlers) HandleTrashItem(w http.ResponseWriter, r *http.Request) {
	err := h.TrashItem.Execute(r.Context(), appvault.TrashItemInput{
		Caller:  middleware.CallerID(r.Context()),
		VaultID: vault.ID(chi.URLParam(r, "vaultId")),
		ItemID:  vault.ItemID(chi.URLParam(r, "id")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleRestoreItem restores a trashed item.
// @Summary Restore item
// @Description Restore a soft-deleted item from trash
// @Tags Trash
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param id path string true "Item ID"
// @Success 204 "No content"
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/trash/{id}/restore [post]
func (h *VaultHandlers) HandleRestoreItem(w http.ResponseWriter, r *http.Request) {
	err := h.RestoreItem.Execute(r.Context(), appvault.RestoreItemInput{
		Caller:  middleware.CallerID(r.Context()),
		VaultID: vault.ID(chi.URLParam(r, "vaultId")),
		ItemID:  vault.ItemID(chi.URLParam(r, "id")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandlePurgeItem permanently deletes a trashed item.
// @Summary Purge item
// @Description Permanently delete a trashed item. Requires step-up authentication.
// @Tags Trash
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param id path string true "Item ID"
// @Success 204 "No content"
// @Failure 403 {object} ErrorBody "Step-up required"
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/trash/{id} [delete]
func (h *VaultHandlers) HandlePurgeItem(w http.ResponseWriter, r *http.Request) {
	err := h.PurgeItem.Execute(r.Context(), appvault.PurgeItemInput{
		Caller:  middleware.CallerID(r.Context()),
		VaultID: vault.ID(chi.URLParam(r, "vaultId")),
		ItemID:  vault.ItemID(chi.URLParam(r, "id")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleListItems returns active items in a vault.
// @Summary List items
// @Description List all active (non-trashed) items in a vault with optional filters
// @Tags Items
// @Produce json
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param favorites query bool false "Filter favorites only"
// @Param folderId query string false "Filter by folder ID"
// @Param itemType query string false "Filter by item type (login, note, card, identity, api_key, ssh_key, passkey)"
// @Success 200 {array} ItemResponse
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/items [get]
func (h *VaultHandlers) HandleListItems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	opts := ports.ItemListOptions{FavoritesOnly: q.Get("favorites") == "true"}
	if s := q.Get("folderId"); s != "" {
		v := vault.FolderID(s)
		opts.FolderID = &v
	}
	if s := q.Get("itemType"); s != "" {
		v := vault.ItemType(s)
		opts.ItemType = &v
	}
	items, err := h.ListActive.Execute(r.Context(), appvault.ListActiveInput{
		Caller: middleware.CallerID(r.Context()), VaultID: vault.ID(chi.URLParam(r, "vaultId")), Options: opts,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]ItemResponse, 0, len(items))
	for _, it := range items {
		out = append(out, itemToDTO(it))
	}
	writeJSON(w, http.StatusOK, out)
}

// HandleListTrash returns trashed items in a vault.
// @Summary List trash
// @Description List all soft-deleted items in a vault
// @Tags Trash
// @Produce json
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Success 200 {array} ItemResponse
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/trash [get]
func (h *VaultHandlers) HandleListTrash(w http.ResponseWriter, r *http.Request) {
	items, err := h.ListTrash.Execute(r.Context(), appvault.ListTrashInput{
		Caller: middleware.CallerID(r.Context()), VaultID: vault.ID(chi.URLParam(r, "vaultId")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]ItemResponse, 0, len(items))
	for _, it := range items {
		out = append(out, itemToDTO(it))
	}
	writeJSON(w, http.StatusOK, out)
}

// ===========================================================================
// Folder handlers
// ===========================================================================

func folderToDTO(f vault.Folder) FolderResponse {
	return FolderResponse{
		ID: string(f.ID), VaultID: string(f.VaultID),
		EncryptedName: encodeB64Blob(f.EncryptedName),
		CreatedAt:     f.CreatedAt.UTC().Format(timeFormat),
	}
}

// HandleCreateFolder creates a new folder in a vault.
// @Summary Create folder
// @Description Create a new encrypted folder in the specified vault
// @Tags Folders
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param body body FolderCreateRequest true "Folder payload"
// @Success 201 {object} FolderResponse
// @Failure 400 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/folders [post]
func (h *VaultHandlers) HandleCreateFolder(w http.ResponseWriter, r *http.Request) {
	var req FolderCreateRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	name, err := decodeB64Blob(req.EncryptedName)
	if err != nil {
		writeError(w, r, err)
		return
	}
	f, err := h.CreateFolder.Execute(r.Context(), appvault.CreateFolderInput{
		Caller: middleware.CallerID(r.Context()), VaultID: vault.ID(chi.URLParam(r, "vaultId")),
		EncryptedName: name,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, folderToDTO(f))
}

// HandleRenameFolder renames a folder.
// @Summary Rename folder
// @Description Update the encrypted name of a folder
// @Tags Folders
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param folderId path string true "Folder ID"
// @Param body body FolderCreateRequest true "New encrypted name"
// @Success 200 {object} FolderResponse
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/folders/{folderId} [put]
func (h *VaultHandlers) HandleRenameFolder(w http.ResponseWriter, r *http.Request) {
	var req FolderCreateRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	name, err := decodeB64Blob(req.EncryptedName)
	if err != nil {
		writeError(w, r, err)
		return
	}
	f, err := h.RenameFolder.Execute(r.Context(), appvault.RenameFolderInput{
		Caller: middleware.CallerID(r.Context()), VaultID: vault.ID(chi.URLParam(r, "vaultId")),
		FolderID: vault.FolderID(chi.URLParam(r, "folderId")), EncryptedName: name,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, folderToDTO(f))
}

// HandleDeleteFolder deletes a folder.
// @Summary Delete folder
// @Description Delete a folder (items in the folder are not deleted, just unlinked)
// @Tags Folders
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param folderId path string true "Folder ID"
// @Success 204 "No content"
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/folders/{folderId} [delete]
func (h *VaultHandlers) HandleDeleteFolder(w http.ResponseWriter, r *http.Request) {
	err := h.DeleteFolder.Execute(r.Context(), appvault.DeleteFolderInput{
		Caller: middleware.CallerID(r.Context()), VaultID: vault.ID(chi.URLParam(r, "vaultId")),
		FolderID: vault.FolderID(chi.URLParam(r, "folderId")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleListFolders returns all folders in a vault.
// @Summary List folders
// @Description List all folders in the specified vault
// @Tags Folders
// @Produce json
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Success 200 {array} FolderResponse
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/folders [get]
func (h *VaultHandlers) HandleListFolders(w http.ResponseWriter, r *http.Request) {
	folders, err := h.ListFolders.Execute(r.Context(), appvault.ListFoldersInput{
		Caller: middleware.CallerID(r.Context()), VaultID: vault.ID(chi.URLParam(r, "vaultId")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]FolderResponse, 0, len(folders))
	for _, f := range folders {
		out = append(out, folderToDTO(f))
	}
	writeJSON(w, http.StatusOK, out)
}

// ===========================================================================
// Sharing handlers
// ===========================================================================

// HandleShareVault adds a member to a shared vault.
// @Summary Share vault
// @Description Add a new member to a shared vault with an encrypted vault key
// @Tags Sharing
// @Accept json
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param body body ShareVaultRequest true "Sharing payload"
// @Success 204 "No content"
// @Failure 400 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/members [post]
func (h *VaultHandlers) HandleShareVault(w http.ResponseWriter, r *http.Request) {
	var req ShareVaultRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	encKey, err := decodeB64Blob(req.EncryptedVaultKey)
	if err != nil {
		writeError(w, r, err)
		return
	}
	sigRaw, err := base64.StdEncoding.DecodeString(req.WrapSignature)
	if err != nil {
		writeError(w, r, err)
		return
	}
	sig, err := crypto.NewEd25519Signature(sigRaw)
	if err != nil {
		writeError(w, r, err)
		return
	}
	err = h.ShareVault.Execute(r.Context(), appvault.ShareVaultInput{
		Caller:            middleware.CallerID(r.Context()),
		VaultID:           vault.ID(chi.URLParam(r, "vaultId")),
		RecipientUserID:   user.ID(req.RecipientUserID),
		EncryptedVaultKey: encKey,
		WrapSignature:     sig,
		Role:              user.Role(req.Role),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleRemoveMember removes a member from a shared vault.
// @Summary Remove member
// @Description Remove a member from a shared vault and signal rekey requirement
// @Tags Sharing
// @Security BearerAuth
// @Produce json
// @Param vaultId path string true "Vault ID"
// @Param userId path string true "User ID to remove"
// @Success 200 {object} RemoveMemberResponse
// @Failure 400 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/members/{userId} [delete]
func (h *VaultHandlers) HandleRemoveMember(w http.ResponseWriter, r *http.Request) {
	out, err := h.RemoveMember.Execute(r.Context(), appvault.RemoveMemberInput{
		Caller:     middleware.CallerID(r.Context()),
		VaultID:    vault.ID(chi.URLParam(r, "vaultId")),
		TargetUser: user.ID(chi.URLParam(r, "userId")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	members := make([]VaultMembershipDTO, 0, len(out.RemainingMembers))
	for _, m := range out.RemainingMembers {
		members = append(members, VaultMembershipDTO{
			VaultID:           string(m.VaultID),
			VaultName:         "",
			VaultType:         "",
			EncryptedVaultKey: encodeB64Blob(m.EncryptedVaultKey),
			SenderID:          string(m.SenderID),
			WrapSignature:     encodeB64(m.WrapSignature.Bytes()),
			Role:              string(m.Role),
		})
	}
	writeJSON(w, http.StatusOK, RemoveMemberResponse{
		RekeyRequired:    out.RekeyRequired,
		RemainingMembers: members,
	})
}

// HandleRekeyVault re-encrypts all items and re-wraps keys after member removal.
// @Summary Rekey vault
// @Description Atomically re-encrypt all items and re-wrap vault keys for remaining members
// @Tags Sharing
// @Accept json
// @Security BearerAuth
// @Param vaultId path string true "Vault ID"
// @Param body body RekeyVaultRequest true "Rekey payload with new keys and re-encrypted items"
// @Success 204 "No content"
// @Failure 400 {object} ErrorBody
// @Failure 404 {object} ErrorBody
// @Router /vaults/{vaultId}/rekey [post]
func (h *VaultHandlers) HandleRekeyVault(w http.ResponseWriter, r *http.Request) {
	var req RekeyVaultRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	vaultID := vault.ID(chi.URLParam(r, "vaultId"))

	newKeys := make([]appvault.RekeyBlob, 0, len(req.NewKeys))
	for _, k := range req.NewKeys {
		encKey, err := decodeB64Blob(k.EncryptedVaultKey)
		if err != nil {
			writeError(w, r, err)
			return
		}
		sigRaw, err := base64.StdEncoding.DecodeString(k.WrapSignature)
		if err != nil {
			writeError(w, r, err)
			return
		}
		sig, err := crypto.NewEd25519Signature(sigRaw)
		if err != nil {
			writeError(w, r, err)
			return
		}
		newKeys = append(newKeys, appvault.RekeyBlob{
			UserID:            user.ID(k.UserID),
			EncryptedVaultKey: encKey,
			WrapSignature:     sig,
		})
	}

	items := make([]appvault.ItemReblob, 0, len(req.Items))
	for _, it := range req.Items {
		data, err := decodeB64Blob(it.EncryptedData)
		if err != nil {
			writeError(w, r, err)
			return
		}
		name, err := decodeB64Blob(it.EncryptedName)
		if err != nil {
			writeError(w, r, err)
			return
		}
		items = append(items, appvault.ItemReblob{
			ItemID:        vault.ItemID(it.ItemID),
			EncryptedData: data,
			EncryptedName: name,
		})
	}

	err := h.RekeyVault.Execute(r.Context(), appvault.RekeyVaultInput{
		Caller:  middleware.CallerID(r.Context()),
		VaultID: vaultID,
		NewKeys: newKeys,
		Items:   items,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
