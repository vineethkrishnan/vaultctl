// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

var _ ports.BackupStore = (*OneDriveStore)(nil)

// OneDriveStore stores artifacts in the app's OneDrive app folder via Microsoft
// Graph (special/approot). Simple uploads cap at 4 MiB; a typical encrypted
// export is well under that.
type OneDriveStore struct {
	client      *http.Client
	accessToken string
}

func NewOneDriveStore(client *http.Client, accessToken string) *OneDriveStore {
	return &OneDriveStore{client: client, accessToken: accessToken}
}

const graphBase = "https://graph.microsoft.com/v1.0/me/drive/special/approot"

func (s *OneDriveStore) auth(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+s.accessToken)
}

func (s *OneDriveStore) itemContentURL(name string) string {
	return graphBase + ":/" + url.PathEscape(name) + ":/content"
}

func (s *OneDriveStore) Put(ctx context.Context, name string, r io.Reader, size int64) error {
	if !artifactName.MatchString(name) {
		return fmt.Errorf("backup/onedrive: invalid artifact name %q", name)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.itemContentURL(name), r)
	if err != nil {
		return err
	}
	s.auth(req)
	req.Header.Set("Content-Type", "application/octet-stream")
	if size > 0 {
		req.ContentLength = size
	}
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("backup/onedrive: upload returned %d", res.StatusCode)
	}
	return nil
}

func (s *OneDriveStore) List(ctx context.Context) ([]ports.StoredObject, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		graphBase+"/children?$select=name,size,lastModifiedDateTime", nil)
	if err != nil {
		return nil, err
	}
	s.auth(req)
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("backup/onedrive: list returned %d", res.StatusCode)
	}
	var parsed struct {
		Value []struct {
			Name                 string `json:"name"`
			Size                 int64  `json:"size"`
			LastModifiedDateTime string `json:"lastModifiedDateTime"`
		} `json:"value"`
	}
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	var out []ports.StoredObject
	for _, e := range parsed.Value {
		if !artifactName.MatchString(e.Name) {
			continue
		}
		obj := ports.StoredObject{Name: e.Name, Size: e.Size}
		if t, err := time.Parse(time.RFC3339, e.LastModifiedDateTime); err == nil {
			obj.ModTime = t
		}
		out = append(out, obj)
	}
	return out, nil
}

func (s *OneDriveStore) Get(ctx context.Context, name string) (io.ReadCloser, error) {
	if !artifactName.MatchString(name) {
		return nil, fmt.Errorf("backup/onedrive: invalid artifact name %q", name)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.itemContentURL(name), nil)
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
		return nil, fmt.Errorf("backup/onedrive: download returned %d", res.StatusCode)
	}
	return res.Body, nil
}

func (s *OneDriveStore) Delete(ctx context.Context, name string) error {
	if !artifactName.MatchString(name) {
		return fmt.Errorf("backup/onedrive: invalid artifact name %q", name)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		graphBase+":/"+url.PathEscape(name), nil)
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
		return fmt.Errorf("backup/onedrive: delete returned %d", res.StatusCode)
	}
	return nil
}
