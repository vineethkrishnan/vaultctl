// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
)

var _ ports.BackupStore = (*S3Store)(nil)

// S3Store stores artifacts in any S3-compatible bucket (AWS S3, Backblaze B2,
// Wasabi, Cloudflare R2, MinIO) using path-style addressing and SigV4. This is
// the credential-based "any other cloud" answer alongside WebDAV.
type S3Store struct {
	client    *http.Client
	endpoint  string // scheme://host, no trailing slash
	region    string
	bucket    string
	accessKey string
	secretKey string
	prefix    string // optional key prefix, no leading slash
	clock     func() time.Time
}

// NewS3Store builds a store from settings: endpoint, region, bucket,
// accessKey, secretKey, prefix (optional).
func NewS3Store(client *http.Client, settings map[string]string, now func() time.Time) (*S3Store, error) {
	endpoint := strings.TrimRight(settings["endpoint"], "/")
	if endpoint == "" || settings["bucket"] == "" || settings["accessKey"] == "" || settings["secretKey"] == "" {
		return nil, fmt.Errorf("backup/s3: endpoint, bucket, accessKey and secretKey are required")
	}
	region := settings["region"]
	if region == "" {
		region = "us-east-1"
	}
	prefix := strings.Trim(settings["prefix"], "/")
	if prefix != "" {
		prefix += "/"
	}
	return &S3Store{
		client: client, endpoint: endpoint, region: region, bucket: settings["bucket"],
		accessKey: settings["accessKey"], secretKey: settings["secretKey"], prefix: prefix,
		clock: now,
	}, nil
}

func (s *S3Store) keyFor(name string) string { return s.prefix + name }

func (s *S3Store) objectURL(key string) string {
	return s.endpoint + "/" + s.bucket + "/" + key
}

// sigv4Sign computes the SigV4 Authorization header for a request whose body
// hashes to payloadHash. headers must already include host and x-amz-date.
func sigv4Sign(method, canonicalURI, canonicalQuery string, headers map[string]string, payloadHash, accessKey, secretKey, region, service string, t time.Time) string {
	amzDate := t.UTC().Format("20060102T150405Z")
	dateStamp := t.UTC().Format("20060102")

	names := make([]string, 0, len(headers))
	lower := map[string]string{}
	for k, v := range headers {
		lk := strings.ToLower(k)
		names = append(names, lk)
		lower[lk] = strings.TrimSpace(v)
	}
	sort.Strings(names)
	var canonHeaders strings.Builder
	for _, n := range names {
		canonHeaders.WriteString(n + ":" + lower[n] + "\n")
	}
	signedHeaders := strings.Join(names, ";")

	canonicalRequest := strings.Join([]string{
		method, canonicalURI, canonicalQuery, canonHeaders.String(), signedHeaders, payloadHash,
	}, "\n")

	scope := dateStamp + "/" + region + "/" + service + "/aws4_request"
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		hashHex([]byte(canonicalRequest)),
	}, "\n")

	kDate := hmacSHA256([]byte("AWS4"+secretKey), dateStamp)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	kSigning := hmacSHA256(kService, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(kSigning, stringToSign))

	return fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKey, scope, signedHeaders, signature)
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

func hashHex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// signedRequest builds an http.Request with SigV4 applied. body is fully read
// to compute the payload hash (artifacts are small).
func (s *S3Store) signedRequest(ctx context.Context, method, rawURL, canonicalURI, canonicalQuery string, body []byte) (*http.Request, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	payloadHash := hashHex(body)
	t := s.clock()
	headers := map[string]string{
		"host":                 u.Host,
		"x-amz-content-sha256": payloadHash,
		"x-amz-date":           t.UTC().Format("20060102T150405Z"),
	}
	auth := sigv4Sign(method, canonicalURI, canonicalQuery, headers, payloadHash,
		s.accessKey, s.secretKey, s.region, "s3", t)

	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, reader)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Authorization", auth)
	return req, nil
}

func (s *S3Store) Put(ctx context.Context, name string, r io.Reader, _ int64) error {
	if !artifactName.MatchString(name) {
		return fmt.Errorf("backup/s3: invalid artifact name %q", name)
	}
	body, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	key := s.keyFor(name)
	req, err := s.signedRequest(ctx, http.MethodPut, s.objectURL(key), "/"+s.bucket+"/"+key, "", body)
	if err != nil {
		return err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("backup/s3: put returned %d", res.StatusCode)
	}
	return nil
}

func (s *S3Store) List(ctx context.Context) ([]ports.StoredObject, error) {
	query := "list-type=2"
	if s.prefix != "" {
		query += "&prefix=" + url.QueryEscape(s.prefix)
	}
	rawURL := s.endpoint + "/" + s.bucket + "?" + query
	req, err := s.signedRequest(ctx, http.MethodGet, rawURL, "/"+s.bucket, query, nil)
	if err != nil {
		return nil, err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("backup/s3: list returned %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Contents []struct {
			Key          string `xml:"Key"`
			Size         int64  `xml:"Size"`
			LastModified string `xml:"LastModified"`
		} `xml:"Contents"`
	}
	if err := xml.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("backup/s3: parse list: %w", err)
	}
	var out []ports.StoredObject
	for _, c := range parsed.Contents {
		name := strings.TrimPrefix(c.Key, s.prefix)
		if !artifactName.MatchString(name) {
			continue
		}
		obj := ports.StoredObject{Name: name, Size: c.Size}
		if t, err := time.Parse(time.RFC3339, c.LastModified); err == nil {
			obj.ModTime = t
		}
		out = append(out, obj)
	}
	return out, nil
}

func (s *S3Store) Get(ctx context.Context, name string) (io.ReadCloser, error) {
	if !artifactName.MatchString(name) {
		return nil, fmt.Errorf("backup/s3: invalid artifact name %q", name)
	}
	key := s.keyFor(name)
	req, err := s.signedRequest(ctx, http.MethodGet, s.objectURL(key), "/"+s.bucket+"/"+key, "", nil)
	if err != nil {
		return nil, err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		res.Body.Close()
		return nil, fmt.Errorf("backup/s3: get returned %d", res.StatusCode)
	}
	return res.Body, nil
}

func (s *S3Store) Delete(ctx context.Context, name string) error {
	if !artifactName.MatchString(name) {
		return fmt.Errorf("backup/s3: invalid artifact name %q", name)
	}
	key := s.keyFor(name)
	req, err := s.signedRequest(ctx, http.MethodDelete, s.objectURL(key), "/"+s.bucket+"/"+key, "", nil)
	if err != nil {
		return err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode != http.StatusNotFound {
		return fmt.Errorf("backup/s3: delete returned %d", res.StatusCode)
	}
	return nil
}
