// Package auth contains authentication use cases: register, prelogin,
// login, refresh, logout. Each use case accepts its ports via a struct
// and exposes a single Execute/Run-style method.
//
// The application layer owns the error vocabulary surfaced through the API:
// callers map these into HTTP status codes in the presenter layer.
package auth

import "errors"

// ErrInvalidCredentials is returned when an email is unknown OR the auth
// hash doesn't match. We deliberately collapse both cases into one error to
// preserve the user-enumeration story (H2).
var ErrInvalidCredentials = errors.New("auth: invalid credentials")

// ErrAccountLocked is returned when the lockout window is active.
var ErrAccountLocked = errors.New("auth: account temporarily locked")

// ErrEmailTaken is returned on registration if the normalised email is
// already in use.
var ErrEmailTaken = errors.New("auth: email already registered")

// ErrWeakMasterPassword echoes the domain signal so handlers can 400 it
// cleanly without importing the domain package directly.
var ErrWeakMasterPassword = errors.New("auth: master password failed strength policy")

// ErrSessionExpired is returned when a refresh attempt races past the
// refresh TTL.
var ErrSessionExpired = errors.New("auth: session expired")

// ErrStepUpRequired signals that the caller presented a valid access token
// but lacks the fresh step-up claim required for a sensitive endpoint (H10).
var ErrStepUpRequired = errors.New("auth: step-up required")
