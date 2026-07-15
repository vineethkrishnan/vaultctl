// SPDX-License-Identifier: AGPL-3.0-or-later

package backup

import (
	"fmt"
	"net"
	"net/http"
	"syscall"
	"time"
)

// newGuardedHTTPClient returns an http.Client whose dialer rejects connections
// to dangerous SSRF targets at connect time. Destinations (WebDAV/S3) take a
// user-supplied URL, so without this a member could point one at the cloud
// metadata endpoint or a loopback service. The check runs on the *resolved* IP
// right before connect (via Dialer.Control), which also defeats DNS rebinding.
//
// RFC1918 / ULA private ranges are allowed by default: a Nextcloud or MinIO on
// the operator's own LAN is a first-class self-hosted backup destination here.
// Multi-user instances can set allowPrivate=false to also block those ranges so
// a member can't probe internal services. What is NEVER a legitimate backup
// target is blocked regardless: loopback, link-local (incl. the 169.254.169.254
// cloud-metadata address), the unspecified address, and multicast.
func NewGuardedHTTPClient(timeout time.Duration, allowPrivate bool) *http.Client {
	dialer := &net.Dialer{Timeout: 30 * time.Second}
	dialer.Control = func(_, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		ip := net.ParseIP(host)
		if ip == nil {
			return fmt.Errorf("backup: unresolved address %q", address)
		}
		return checkDialIP(ip, allowPrivate)
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: &http.Transport{DialContext: dialer.DialContext},
	}
}

// checkDialIP rejects IPs that are never a legitimate backup destination. When
// allowPrivate is false it additionally rejects RFC1918 / ULA private ranges.
func checkDialIP(ip net.IP, allowPrivate bool) error {
	switch {
	case ip.IsLoopback():
		return fmt.Errorf("backup: refusing to connect to loopback address %s", ip)
	case ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast():
		// Covers 169.254.0.0/16 (incl. 169.254.169.254 metadata) and fe80::/10.
		return fmt.Errorf("backup: refusing to connect to link-local address %s", ip)
	case ip.IsUnspecified():
		return fmt.Errorf("backup: refusing to connect to unspecified address %s", ip)
	case ip.IsMulticast():
		return fmt.Errorf("backup: refusing to connect to multicast address %s", ip)
	case !allowPrivate && ip.IsPrivate():
		// RFC1918 (10/8, 172.16/12, 192.168/16) and ULA (fc00::/7).
		return fmt.Errorf("backup: refusing to connect to private address %s (VAULTCTL_BACKUP_ALLOW_PRIVATE=false)", ip)
	}
	return nil
}
