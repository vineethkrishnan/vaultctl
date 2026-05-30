// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	appvault "github.com/vineethkrishnan/vaultctl/internal/application/vault"
	"github.com/vineethkrishnan/vaultctl/internal/domain"
	"github.com/vineethkrishnan/vaultctl/internal/domain/vault"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api/middleware"
)

// AttachmentHandlers serve the encrypted-attachment endpoints. Ciphertext is
// streamed in/out; metadata (including the wrapped file key) comes from the
// list endpoint so the client can decrypt after downloading the bytes.
type AttachmentHandlers struct {
	Create   *appvault.CreateAttachment
	List     *appvault.ListAttachments
	Get      *appvault.GetAttachment
	Delete   *appvault.DeleteAttachment
	MaxBytes int64
}

// HandleList returns the attachment metadata for an item.
func (h *AttachmentHandlers) HandleList(w http.ResponseWriter, r *http.Request) {
	list, err := h.List.Execute(r.Context(), appvault.ListAttachmentsInput{
		Caller:  middleware.CallerID(r.Context()),
		VaultID: vault.ID(chi.URLParam(r, "vaultId")),
		ItemID:  vault.ItemID(chi.URLParam(r, "id")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]AttachmentResponse, 0, len(list))
	for _, a := range list {
		out = append(out, attachmentToDTO(a))
	}
	writeJSON(w, http.StatusOK, out)
}

// HandleCreate accepts a multipart upload: form fields encryptedFilename +
// wrappedFileKey and a "file" part carrying the ciphertext.
func (h *AttachmentHandlers) HandleCreate(w http.ResponseWriter, r *http.Request) {
	if h.MaxBytes > 0 {
		// Hard cap the whole request to the file cap plus slack for the
		// multipart envelope + metadata fields.
		r.Body = http.MaxBytesReader(w, r.Body, h.MaxBytes+(1<<20))
	}
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		writeError(w, r, domain.NewInvalid("attachment", "invalid or oversized upload"))
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, r, domain.NewInvalid("file", "a file part is required"))
		return
	}
	defer file.Close()

	att, err := h.Create.Execute(r.Context(), appvault.CreateAttachmentInput{
		Caller:            middleware.CallerID(r.Context()),
		VaultID:           vault.ID(chi.URLParam(r, "vaultId")),
		ItemID:            vault.ItemID(chi.URLParam(r, "id")),
		EncryptedFilename: r.FormValue("encryptedFilename"),
		WrappedFileKey:    r.FormValue("wrappedFileKey"),
		Body:              file,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, attachmentToDTO(att))
}

// HandleDownload streams the raw ciphertext. The client already holds the
// wrapped key + filename from the list endpoint; the X- headers are a
// convenience for same-origin callers.
func (h *AttachmentHandlers) HandleDownload(w http.ResponseWriter, r *http.Request) {
	res, err := h.Get.Execute(r.Context(), appvault.GetAttachmentInput{
		Caller:       middleware.CallerID(r.Context()),
		VaultID:      vault.ID(chi.URLParam(r, "vaultId")),
		ItemID:       vault.ItemID(chi.URLParam(r, "id")),
		AttachmentID: vault.AttachmentID(chi.URLParam(r, "attachmentId")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	defer res.Body.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(res.Attachment.CiphertextSize, 10))
	w.Header().Set("X-Encrypted-Filename", res.Attachment.EncryptedFilename)
	w.Header().Set("X-Wrapped-File-Key", res.Attachment.WrappedFileKey)
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, res.Body)
}

// HandleDelete removes an attachment.
func (h *AttachmentHandlers) HandleDelete(w http.ResponseWriter, r *http.Request) {
	err := h.Delete.Execute(r.Context(), appvault.DeleteAttachmentInput{
		Caller:       middleware.CallerID(r.Context()),
		VaultID:      vault.ID(chi.URLParam(r, "vaultId")),
		ItemID:       vault.ItemID(chi.URLParam(r, "id")),
		AttachmentID: vault.AttachmentID(chi.URLParam(r, "attachmentId")),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
