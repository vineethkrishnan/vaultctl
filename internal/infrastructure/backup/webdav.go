// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

var _ ports.BackupStore = (*WebDAVStore)(nil)

// WebDAVStore writes artifacts to a WebDAV collection (Nextcloud, ownCloud,
// Apache mod_dav, and many self-hosted clouds). Credential-based, no OAuth -
// this is the "any other cloud of your choice" answer, and the bridge for
// stores without a public API.
type WebDAVStore struct {
	client   *http.Client
	baseURL  string // collection URL, no trailing slash
	username string
	password string
}

// NewWebDAVStore builds a store from settings: url, username, password.
func NewWebDAVStore(client *http.Client, settings map[string]string) (*WebDAVStore, error) {
	base := strings.TrimRight(settings["url"], "/")
	if base == "" {
		return nil, fmt.Errorf("backup/webdav: missing url")
	}
	return &WebDAVStore{
		client:   client,
		baseURL:  base,
		username: settings["username"],
		password: settings["password"],
	}, nil
}

func (s *WebDAVStore) urlFor(name string) (string, error) {
	if !artifactName.MatchString(name) {
		return "", fmt.Errorf("backup/webdav: invalid artifact name %q", name)
	}
	return s.baseURL + "/" + name, nil
}

func (s *WebDAVStore) do(req *http.Request) (*http.Response, error) {
	if s.username != "" || s.password != "" {
		req.SetBasicAuth(s.username, s.password)
	}
	return s.client.Do(req)
}

func (s *WebDAVStore) Put(ctx context.Context, name string, r io.Reader, size int64) error {
	target, err := s.urlFor(name)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, target, r)
	if err != nil {
		return err
	}
	if size > 0 {
		req.ContentLength = size
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	res, err := s.do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("backup/webdav: put %s returned %d", name, res.StatusCode)
	}
	return nil
}

type davMultistatus struct {
	Responses []struct {
		Href     string `xml:"href"`
		Propstat []struct {
			Prop struct {
				ContentLength string `xml:"getcontentlength"`
				LastModified  string `xml:"getlastmodified"`
				ResourceType  struct {
					Collection *struct{} `xml:"collection"`
				} `xml:"resourcetype"`
			} `xml:"prop"`
		} `xml:"propstat"`
	} `xml:"response"`
}

func (s *WebDAVStore) List(ctx context.Context) ([]ports.StoredObject, error) {
	req, err := http.NewRequestWithContext(ctx, "PROPFIND", s.baseURL+"/", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Depth", "1")
	req.Header.Set("Content-Type", "application/xml")
	res, err := s.do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if res.StatusCode >= 300 && res.StatusCode != 207 {
		return nil, fmt.Errorf("backup/webdav: propfind returned %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	var ms davMultistatus
	if err := xml.Unmarshal(body, &ms); err != nil {
		return nil, fmt.Errorf("backup/webdav: parse propfind: %w", err)
	}
	var out []ports.StoredObject
	for _, resp := range ms.Responses {
		name := path.Base(strings.TrimRight(resp.Href, "/"))
		if !artifactName.MatchString(name) {
			continue // the collection itself or unrelated entries
		}
		obj := ports.StoredObject{Name: name}
		for _, ps := range resp.Propstat {
			if ps.Prop.ResourceType.Collection != nil {
				obj.Name = ""
				break
			}
			fmt.Sscanf(ps.Prop.ContentLength, "%d", &obj.Size)
			if t, err := time.Parse(time.RFC1123, ps.Prop.LastModified); err == nil {
				obj.ModTime = t
			}
		}
		if obj.Name != "" {
			out = append(out, obj)
		}
	}
	return out, nil
}

func (s *WebDAVStore) Get(ctx context.Context, name string) (io.ReadCloser, error) {
	target, err := s.urlFor(name)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	res, err := s.do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		res.Body.Close()
		return nil, fmt.Errorf("backup/webdav: get %s returned %d", name, res.StatusCode)
	}
	return res.Body, nil
}

func (s *WebDAVStore) Delete(ctx context.Context, name string) error {
	target, err := s.urlFor(name)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, target, nil)
	if err != nil {
		return err
	}
	res, err := s.do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode != http.StatusNotFound {
		return fmt.Errorf("backup/webdav: delete %s returned %d", name, res.StatusCode)
	}
	return nil
}
