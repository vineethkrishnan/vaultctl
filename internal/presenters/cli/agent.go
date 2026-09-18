// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin || linux

package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// The agent is the CLI's equivalent of ssh-agent: a per-user background
// process that keeps the 32-byte stretched key in memory between
// invocations so `get`, `totp` and `run` do not re-prompt for the master
// password. It never writes the key anywhere; it is zeroed on lock, on idle
// timeout and on shutdown.

const (
	agentOpStatus = "status"
	agentOpUnlock = "unlock"
	agentOpKey    = "key"
	agentOpLock   = "lock"

	agentDialTimeout = 500 * time.Millisecond
)

type agentRequest struct {
	Op      string `json:"op"`
	Key     []byte `json:"key,omitempty"`
	Timeout string `json:"timeout,omitempty"`
}

type agentResponse struct {
	OK        bool      `json:"ok"`
	Error     string    `json:"error,omitempty"`
	Locked    bool      `json:"locked"`
	Key       []byte    `json:"key,omitempty"`
	ExpiresAt time.Time `json:"expiresAt,omitempty"`
}

// agentSocketPath is $XDG_RUNTIME_DIR/vaultctl/agent.sock when the runtime
// dir exists (tmpfs, per-user, wiped at logout on systemd hosts), else the
// user cache dir. The directory is created 0700.
func agentSocketPath() (string, error) {
	base := os.Getenv("XDG_RUNTIME_DIR")
	if base == "" {
		cacheDir, err := os.UserCacheDir()
		if err != nil {
			return "", fmt.Errorf("agent socket dir: %w", err)
		}
		base = cacheDir
	}
	dir := filepath.Join(base, "vaultctl")
	if err := os.MkdirAll(dir, 0o700); err != nil { //nolint:gosec // G703: dir is XDG_RUNTIME_DIR or the user cache dir plus a fixed name
		return "", fmt.Errorf("agent socket dir: %w", err)
	}
	return filepath.Join(dir, "agent.sock"), nil
}

type agentState struct {
	mu      sync.Mutex
	key     []byte
	timeout time.Duration
	expires time.Time
}

func (s *agentState) unlock(key []byte, timeout time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.zeroLocked()
	s.key = append([]byte(nil), key...)
	if timeout > 0 {
		s.timeout = timeout
	}
	s.expires = time.Now().Add(s.timeout)
}

func (s *agentState) fetch() ([]byte, time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.key != nil && time.Now().After(s.expires) {
		s.zeroLocked()
	}
	if s.key == nil {
		return nil, time.Time{}
	}
	s.expires = time.Now().Add(s.timeout)
	return append([]byte(nil), s.key...), s.expires
}

func (s *agentState) status() (bool, time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.key == nil, s.expires
}

func (s *agentState) lock() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.zeroLocked()
}

func (s *agentState) expireIfIdle(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.key != nil && now.After(s.expires) {
		s.zeroLocked()
	}
}

func (s *agentState) zeroLocked() {
	for i := range s.key {
		s.key[i] = 0
	}
	s.key = nil
	s.expires = time.Time{}
}

// runAgent serves the socket until ctx is done or SIGINT/SIGTERM arrives.
// A stale socket file left by a crashed agent is replaced when nothing
// answers on it.
func runAgent(ctx context.Context, socketPath string, timeout time.Duration) error {
	if conn, err := net.DialTimeout("unix", socketPath, agentDialTimeout); err == nil {
		_ = conn.Close()
		return errors.New("an agent is already listening on " + socketPath)
	}
	_ = os.Remove(socketPath)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return fmt.Errorf("agent listen: %w", err)
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		_ = listener.Close()
		return fmt.Errorf("agent socket perms: %w", err)
	}

	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()

	state := &agentState{timeout: timeout}
	defer state.lock()

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				state.expireIfIdle(now)
			}
		}
	}()
	go func() {
		<-ctx.Done()
		_ = listener.Close()
		_ = os.Remove(socketPath)
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("agent accept: %w", err)
		}
		go serveAgentConn(conn, state)
	}
}

func serveAgentConn(conn net.Conn, state *agentState) {
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))

	if err := requireSameUser(conn); err != nil {
		_ = json.NewEncoder(conn).Encode(agentResponse{Error: err.Error()})
		return
	}
	var req agentRequest
	if err := json.NewDecoder(conn).Decode(&req); err != nil {
		_ = json.NewEncoder(conn).Encode(agentResponse{Error: "bad request"})
		return
	}
	_ = json.NewEncoder(conn).Encode(handleAgentRequest(state, req))
}

func handleAgentRequest(state *agentState, req agentRequest) agentResponse {
	switch req.Op {
	case agentOpStatus:
		locked, expires := state.status()
		return agentResponse{OK: true, Locked: locked, ExpiresAt: expires}
	case agentOpUnlock:
		if len(req.Key) != 32 {
			return agentResponse{Error: "unlock needs a 32-byte key"}
		}
		var timeout time.Duration
		if req.Timeout != "" {
			parsed, err := time.ParseDuration(req.Timeout)
			if err != nil {
				return agentResponse{Error: "bad timeout: " + err.Error()}
			}
			timeout = parsed
		}
		state.unlock(req.Key, timeout)
		_, expires := state.status()
		return agentResponse{OK: true, Locked: false, ExpiresAt: expires}
	case agentOpKey:
		key, expires := state.fetch()
		if key == nil {
			return agentResponse{OK: true, Locked: true}
		}
		return agentResponse{OK: true, Locked: false, Key: key, ExpiresAt: expires}
	case agentOpLock:
		state.lock()
		return agentResponse{OK: true, Locked: true}
	default:
		return agentResponse{Error: "unknown op " + req.Op}
	}
}

// requireSameUser rejects a peer whose uid differs from ours. The 0600
// socket already enforces this on the filesystem; the credential check
// closes the gap when the parent directory is ever misconfigured.
func requireSameUser(conn net.Conn) error {
	unixConn, ok := conn.(*net.UnixConn)
	if !ok {
		return errors.New("not a unix connection")
	}
	raw, err := unixConn.SyscallConn()
	if err != nil {
		return err
	}
	var peerUID uint32
	var credErr error
	if err := raw.Control(func(fd uintptr) { peerUID, credErr = peerUIDOf(int(fd)) }); err != nil {
		return err
	}
	if credErr != nil {
		return credErr
	}
	if peerUID != uint32(os.Getuid()) { //nolint:gosec // G115: uids are non-negative
		return errors.New("peer uid mismatch")
	}
	return nil
}
