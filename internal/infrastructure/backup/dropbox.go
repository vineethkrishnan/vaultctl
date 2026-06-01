// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

var _ ports.BackupStore = (*DropboxStore)(nil)

// DropboxStore stores artifacts in the app's Dropbox app folder. Paths are
// relative to that folder (App Folder access), so artifacts live at /<name>.
type DropboxStore struct {
	client      *http.Client
	accessToken string
}

func NewDropboxStore(client *http.Client, accessToken string) *DropboxStore {
	return &DropboxStore{client: client, accessToken: accessToken}
}

func (s *DropboxStore) auth(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+s.accessToken)
}

func (s *DropboxStore) Put(ctx context.Context, name string, r io.Reader, _ int64) error {
	if !artifactName.MatchString(name) {
		return fmt.Errorf("backup/dropbox: invalid artifact name %q", name)
	}
	arg, _ := json.Marshal(map[string]any{"path": "/" + name, "mode": "overwrite", "mute": true})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://content.dropboxapi.com/2/files/upload", r)
	if err != nil {
		return err
	}
	s.auth(req)
	req.Header.Set("Dropbox-API-Arg", string(arg))
	req.Header.Set("Content-Type", "application/octet-stream")
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("backup/dropbox: upload returned %d", res.StatusCode)
	}
	return nil
}

func (s *DropboxStore) List(ctx context.Context) ([]ports.StoredObject, error) {
	body, _ := json.Marshal(map[string]any{"path": "", "recursive": false})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.dropboxapi.com/2/files/list_folder", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	s.auth(req)
	req.Header.Set("Content-Type", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == 409 {
		return nil, nil // path not found yet (no backups)
	}
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("backup/dropbox: list returned %d", res.StatusCode)
	}
	var parsed struct {
		Entries []struct {
			Tag            string `json:".tag"`
			Name           string `json:"name"`
			Size           int64  `json:"size"`
			ServerModified string `json:"server_modified"`
		} `json:"entries"`
	}
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	var out []ports.StoredObject
	for _, e := range parsed.Entries {
		if e.Tag != "file" || !artifactName.MatchString(e.Name) {
			continue
		}
		obj := ports.StoredObject{Name: e.Name, Size: e.Size}
		if t, err := time.Parse(time.RFC3339, e.ServerModified); err == nil {
			obj.ModTime = t
		}
		out = append(out, obj)
	}
	return out, nil
}

func (s *DropboxStore) Get(ctx context.Context, name string) (io.ReadCloser, error) {
	if !artifactName.MatchString(name) {
		return nil, fmt.Errorf("backup/dropbox: invalid artifact name %q", name)
	}
	arg, _ := json.Marshal(map[string]any{"path": "/" + name})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://content.dropboxapi.com/2/files/download", nil)
	if err != nil {
		return nil, err
	}
	s.auth(req)
	req.Header.Set("Dropbox-API-Arg", string(arg))
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		res.Body.Close()
		return nil, fmt.Errorf("backup/dropbox: download returned %d", res.StatusCode)
	}
	return res.Body, nil
}

func (s *DropboxStore) Delete(ctx context.Context, name string) error {
	if !artifactName.MatchString(name) {
		return fmt.Errorf("backup/dropbox: invalid artifact name %q", name)
	}
	body, _ := json.Marshal(map[string]any{"path": "/" + name})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.dropboxapi.com/2/files/delete_v2", bytes.NewReader(body))
	if err != nil {
		return err
	}
	s.auth(req)
	req.Header.Set("Content-Type", "application/json")
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode != 409 {
		return fmt.Errorf("backup/dropbox: delete returned %d", res.StatusCode)
	}
	return nil
}
