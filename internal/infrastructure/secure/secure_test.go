// SPDX-License-Identifier: AGPL-3.0-or-later

package secure

import (
	"bytes"
	"testing"
)

func TestNewSecretFromBytes_EmptyInputReturnsNil(t *testing.T) {
	t.Parallel()
	if s := NewSecretFromBytes(nil); s != nil {
		t.Fatalf("nil input should yield nil Secret, got %+v", s)
	}
	if s := NewSecretFromBytes([]byte{}); s != nil {
		t.Fatalf("empty input should yield nil Secret, got %+v", s)
	}
}

func TestNewSecretFromBytes_WipesSource(t *testing.T) {
	t.Parallel()
	src := []byte("super-secret-pepper-bytes")
	want := make([]byte, len(src))
	copy(want, src)
	s := NewSecretFromBytes(src)
	defer s.Destroy()

	// memguard wipes the source slice as part of the move
	if !bytes.Equal(src, bytes.Repeat([]byte{0}, len(src))) {
		t.Fatalf("source slice was not wiped: %x", src)
	}

	// The Secret still holds the original bytes
	s.Open(func(got []byte) {
		if !bytes.Equal(got, want) {
			t.Fatalf("Open returned %x, want %x", got, want)
		}
	})
}

func TestSecret_OpenAfterDestroyIsNoop(t *testing.T) {
	t.Parallel()
	s := NewSecretFromBytes([]byte("k1"))
	s.Destroy()

	called := false
	s.Open(func(b []byte) {
		called = true
		if b != nil {
			t.Fatalf("Open after Destroy should yield nil, got %x", b)
		}
	})
	if !called {
		t.Fatalf("Open's callback must still run")
	}
	if !s.IsZero() {
		t.Fatalf("IsZero must be true after Destroy")
	}
}

func TestSecret_DestroyIsIdempotent(t *testing.T) {
	t.Parallel()
	s := NewSecretFromBytes([]byte("idempotent"))
	s.Destroy()
	s.Destroy() // second call must not panic
}

func TestWithBytes_ReturnsValue(t *testing.T) {
	t.Parallel()
	s := NewSecretFromBytes([]byte("pepper"))
	defer s.Destroy()

	got := WithBytes(s, func(b []byte) int { return len(b) })
	if got != len("pepper") {
		t.Fatalf("WithBytes returned %d, want %d", got, len("pepper"))
	}
}
