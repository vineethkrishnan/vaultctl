// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !darwin && !linux

package cli

import (
	"errors"
	"time"
)

// Platforms without a unix-socket agent keep the single-shot behaviour:
// every decrypting command prompts for the master password.

const defaultAgentTimeout = time.Hour

var errAgentUnsupported = errors.New("the vaultctl agent is only available on macOS and Linux")

func agentFetchKey() ([]byte, error) { return nil, nil }

func agentStoreKey([]byte, time.Duration) (time.Time, error) {
	return time.Time{}, errAgentUnsupported
}

func agentStoreKeyIfRunning([]byte) {}

func agentLock() error { return nil }

func agentStatus() (bool, bool, time.Time, error) { return false, true, time.Time{}, nil }
