package api

import (
	"encoding/base64"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	appvault "github.com/vineethkrishnan/vaultctl/internal/application/vault"
	"github.com/vineethkrishnan/vaultctl/internal/domain/crypto"
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
}

// GET /api/v1/vaults
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

// POST /api/v1/vaults
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

// POST /api/v1/vaults/:vaultId/items
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

// GET /api/v1/vaults/:vaultId/items/:id
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

// PUT /api/v1/vaults/:vaultId/items/:id
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

// DELETE /api/v1/vaults/:vaultId/items/:id (soft)
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

// POST /api/v1/vaults/:vaultId/trash/:id/restore
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

// DELETE /api/v1/vaults/:vaultId/trash/:id (hard, step-up required — wired at router)
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

// GET /api/v1/vaults/:vaultId/items
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

// GET /api/v1/vaults/:vaultId/trash
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

// POST /api/v1/vaults/:vaultId/folders
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

// PUT /api/v1/vaults/:vaultId/folders/:folderId
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

// DELETE /api/v1/vaults/:vaultId/folders/:folderId
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

// GET /api/v1/vaults/:vaultId/folders
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
