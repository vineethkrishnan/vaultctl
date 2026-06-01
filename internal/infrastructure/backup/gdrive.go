// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

var _ ports.BackupStore = (*GoogleDriveStore)(nil)

// GoogleDriveStore stores artifacts in the app's private appDataFolder (scope
// drive.appdata), so it never touches the user's visible Drive and needs no
// folder management.
type GoogleDriveStore struct {
	client      *http.Client
	accessToken string
}

func NewGoogleDriveStore(client *http.Client, accessToken string) *GoogleDriveStore {
	return &GoogleDriveStore{client: client, accessToken: accessToken}
}

func (s *GoogleDriveStore) auth(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+s.accessToken)
}

type driveFile struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Size         string `json:"size"`
	ModifiedTime string `json:"modifiedTime"`
}

func (s *GoogleDriveStore) Put(ctx context.Context, name string, r io.Reader, _ int64) error {
	if !artifactName.MatchString(name) {
		return fmt.Errorf("backup/gdrive: invalid artifact name %q", name)
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)

	meta, _ := mw.CreatePart(textproto.MIMEHeader{"Content-Type": {"application/json; charset=UTF-8"}})
	_ = json.NewEncoder(meta).Encode(map[string]any{"name": name, "parents": []string{"appDataFolder"}})

	media, _ := mw.CreatePart(textproto.MIMEHeader{"Content-Type": {"application/octet-stream"}})
	if _, err := io.Copy(media, r); err != nil {
		return err
	}
	if err := mw.Close(); err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", &body)
	if err != nil {
		return err
	}
	s.auth(req)
	req.Header.Set("Content-Type", "multipart/related; boundary="+mw.Boundary())
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("backup/gdrive: upload returned %d", res.StatusCode)
	}
	return nil
}

func (s *GoogleDriveStore) List(ctx context.Context) ([]ports.StoredObject, error) {
	files, err := s.listFiles(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ports.StoredObject, 0, len(files))
	for _, f := range files {
		if !artifactName.MatchString(f.Name) {
			continue
		}
		obj := ports.StoredObject{Name: f.Name}
		obj.Size, _ = strconv.ParseInt(f.Size, 10, 64)
		if t, err := time.Parse(time.RFC3339, f.ModifiedTime); err == nil {
			obj.ModTime = t
		}
		out = append(out, obj)
	}
	return out, nil
}

func (s *GoogleDriveStore) listFiles(ctx context.Context) ([]driveFile, error) {
	q := url.Values{}
	q.Set("spaces", "appDataFolder")
	q.Set("fields", "files(id,name,size,modifiedTime)")
	q.Set("pageSize", "1000")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://www.googleapis.com/drive/v3/files?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	s.auth(req)
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("backup/gdrive: list returned %d", res.StatusCode)
	}
	var parsed struct {
		Files []driveFile `json:"files"`
	}
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	return parsed.Files, nil
}

func (s *GoogleDriveStore) resolveID(ctx context.Context, name string) (string, error) {
	files, err := s.listFiles(ctx)
	if err != nil {
		return "", err
	}
	for _, f := range files {
		if f.Name == name {
			return f.ID, nil
		}
	}
	return "", fmt.Errorf("backup/gdrive: %q not found", name)
}

func (s *GoogleDriveStore) Get(ctx context.Context, name string) (io.ReadCloser, error) {
	id, err := s.resolveID(ctx, name)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://www.googleapis.com/drive/v3/files/"+url.PathEscape(id)+"?alt=media", nil)
	if err != nil {
		return nil, err
	}
	s.auth(req)
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		res.Body.Close()
		return nil, fmt.Errorf("backup/gdrive: download returned %d", res.StatusCode)
	}
	return res.Body, nil
}

func (s *GoogleDriveStore) Delete(ctx context.Context, name string) error {
	id, err := s.resolveID(ctx, name)
	if err != nil {
		return nil // already gone
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		"https://www.googleapis.com/drive/v3/files/"+url.PathEscape(id), nil)
	if err != nil {
		return err
	}
	s.auth(req)
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode != http.StatusNotFound {
		return fmt.Errorf("backup/gdrive: delete returned %d", res.StatusCode)
	}
	return nil
}
