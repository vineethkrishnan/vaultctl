// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWebDAVStore(t *testing.T) {
	store := map[string][]byte{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		switch r.Method {
		case http.MethodPut:
			body, _ := io.ReadAll(r.Body)
			store[name] = body
			w.WriteHeader(http.StatusCreated)
		case http.MethodGet:
			b, ok := store[name]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_, _ = w.Write(b)
		case http.MethodDelete:
			delete(store, name)
			w.WriteHeader(http.StatusNoContent)
		case "PROPFIND":
			var sb strings.Builder
			sb.WriteString(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">`)
			sb.WriteString(`<d:response><d:href>/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`)
			for n, b := range store {
				sb.WriteString(`<d:response><d:href>/` + n + `</d:href><d:propstat><d:prop>`)
				sb.WriteString(`<d:getcontentlength>` + itoa(len(b)) + `</d:getcontentlength>`)
				sb.WriteString(`<d:getlastmodified>Mon, 02 Jan 2006 15:04:05 GMT</d:getlastmodified>`)
				sb.WriteString(`<d:resourcetype/></d:prop></d:propstat></d:response>`)
			}
			sb.WriteString(`</d:multistatus>`)
			w.WriteHeader(207)
			_, _ = w.Write([]byte(sb.String()))
		}
	}))
	defer srv.Close()

	s, err := NewWebDAVStore(srv.Client(), map[string]string{"url": srv.URL, "username": "u", "password": "p"})
	if err != nil {
		t.Fatalf("NewWebDAVStore: %v", err)
	}
	ctx := context.Background()
	name := "vaultctl-export-20260601-120000.vctlbak"
	want := []byte("sealed-bytes")

	if err := s.Put(ctx, name, bytes.NewReader(want), int64(len(want))); err != nil {
		t.Fatalf("Put: %v", err)
	}
	objs, err := s.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(objs) != 1 || objs[0].Name != name {
		t.Fatalf("List = %+v", objs)
	}
	rc, err := s.Get(ctx, name)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	got, _ := io.ReadAll(rc)
	rc.Close()
	if !bytes.Equal(got, want) {
		t.Fatalf("Get mismatch: %q", got)
	}
	if err := s.Delete(ctx, name); err != nil {
		t.Fatalf("Delete: %v", err)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
