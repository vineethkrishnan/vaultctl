// SPDX-License-Identifier: AGPL-3.0-or-later

package clientcrypto

import (
	"crypto/sha256"
	"errors"
	"io"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/hkdf"

	"github.com/vineethkrishnan/vaultctl/internal/domain/user"
)

// DerivedKeys mirrors the TS DerivedKeys plus the intermediate masterKey.
// The master key is exposed so callers can zeroise it explicitly once they
// are done - see Zero().
type DerivedKeys struct {
	MasterKey    []byte // 32 bytes - must be zeroed on exit
	StretchedKey []byte // 32 bytes - HKDF(master, "enc")
	AuthHash     []byte // 32 bytes - HKDF(master, "auth")
}

// Zero scrubs every byte of the derived material in place. Callers MUST call
// this once they have posted the auth hash / consumed the stretched key.
func (d *DerivedKeys) Zero() {
	for i := range d.MasterKey {
		d.MasterKey[i] = 0
	}
	for i := range d.StretchedKey {
		d.StretchedKey[i] = 0
	}
	for i := range d.AuthHash {
		d.AuthHash[i] = 0
	}
}

// ErrSaltTooShort matches web/src/shared/crypto/argon2.ts.
var ErrSaltTooShort = errors.New("clientcrypto: salt must be at least 16 bytes")

// DeriveKeys runs Argon2id(password, salt, params) to get a 32-byte master
// key, then expands it into {authHash, stretchedKey} via HKDF-SHA256 with the
// fixed context strings "auth" and "enc" from architecture §6.1.
//
// This mirrors web/src/shared/crypto/kdf.ts exactly so CLI-derived auth
// hashes interoperate with browser-derived ones for the same password.
func DeriveKeys(password string, salt []byte, params user.KDFParams) (DerivedKeys, error) {
	if len(salt) < 16 {
		return DerivedKeys{}, ErrSaltTooShort
	}
	if err := params.Validate(); err != nil {
		return DerivedKeys{}, err
	}

	// Argon2id(password, salt, iterations, memoryKB, parallelism, 32-byte output)
	masterKey := argon2.IDKey(
		[]byte(password),
		salt,
		params.Iterations,
		params.MemoryKB,
		params.Parallelism,
		32,
	)

	authHash, err := hkdfExpand(masterKey, []byte("auth"))
	if err != nil {
		return DerivedKeys{}, err
	}
	stretchedKey, err := hkdfExpand(masterKey, []byte("enc"))
	if err != nil {
		return DerivedKeys{}, err
	}
	return DerivedKeys{
		MasterKey:    masterKey,
		StretchedKey: stretchedKey,
		AuthHash:     authHash,
	}, nil
}

// hkdfExpand runs HKDF-SHA256 with an empty salt (RFC 5869 zero-filled) and
// the supplied info string, returning 32 bytes.
func hkdfExpand(ikm, info []byte) ([]byte, error) {
	reader := hkdf.New(sha256.New, ikm, nil, info)
	out := make([]byte, 32)
	if _, err := io.ReadFull(reader, out); err != nil {
		return nil, err
	}
	return out, nil
}
