// SPDX-License-Identifier: AGPL-3.0-or-later

package clientcrypto_test

import (
	"bytes"
	"testing"

	"github.com/vineethkrishnan/vaultctl/internal/application/clientcrypto"
)

func TestPadUnpad_RoundTrip(t *testing.T) {
	for _, size := range []int{0, 1, 31, 32, 33, 63, 64, 65, 100} {
		in := bytes.Repeat([]byte{0xAA}, size)
		padded := clientcrypto.Pad(in)
		if len(padded)%32 != 0 {
			t.Errorf("size %d: padded length %d not a multiple of 32", size, len(padded))
		}
		if len(padded) == len(in) {
			t.Errorf("size %d: full block must always be added", size)
		}
		out, err := clientcrypto.Unpad(padded)
		if err != nil {
			t.Errorf("size %d: unpad: %v", size, err)
			continue
		}
		if !bytes.Equal(out, in) {
			t.Errorf("size %d: round trip mismatch", size)
		}
	}
}

func TestUnpad_InvalidLength(t *testing.T) {
	if _, err := clientcrypto.Unpad([]byte{0x01, 0x02}); err == nil {
		t.Errorf("expected error on non-multiple-of-32 input")
	}
	if _, err := clientcrypto.Unpad(nil); err == nil {
		t.Errorf("expected error on empty input")
	}
}

func TestUnpad_InvalidPadByte(t *testing.T) {
	bad := make([]byte, 32)
	bad[31] = 0x00
	if _, err := clientcrypto.Unpad(bad); err == nil {
		t.Errorf("expected error on zero pad byte")
	}
	bad[31] = 0x40 // > block size
	if _, err := clientcrypto.Unpad(bad); err == nil {
		t.Errorf("expected error on pad byte > block size")
	}
}

func TestUnpad_InconsistentBytes(t *testing.T) {
	padded := make([]byte, 32)
	for i := range padded {
		padded[i] = 32
	}
	padded[0] = 0x00 // one byte doesn't match
	if _, err := clientcrypto.Unpad(padded); err == nil {
		t.Errorf("expected error on inconsistent pad bytes")
	}
}
