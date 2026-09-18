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
	"os/exec"
	"syscall"
	"time"
)

const defaultAgentTimeout = time.Hour

// errNoAgent means nothing is listening on the socket. Callers treat it as
// "locked" rather than as a failure so the prompt fallback stays available.
var errNoAgent = errors.New("vaultctl agent is not running")

func agentCall(req agentRequest) (agentResponse, error) {
	socketPath, err := agentSocketPath()
	if err != nil {
		return agentResponse{}, err
	}
	conn, err := net.DialTimeout("unix", socketPath, agentDialTimeout)
	if err != nil {
		return agentResponse{}, errNoAgent
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	if err := json.NewEncoder(conn).Encode(req); err != nil {
		return agentResponse{}, fmt.Errorf("agent: %w", err)
	}
	var resp agentResponse
	if err := json.NewDecoder(conn).Decode(&resp); err != nil {
		return agentResponse{}, fmt.Errorf("agent: %w", err)
	}
	if resp.Error != "" {
		return agentResponse{}, errors.New("agent: " + resp.Error)
	}
	return resp, nil
}

// agentFetchKey returns the cached stretched key, or nil when the agent is
// absent or locked.
func agentFetchKey() ([]byte, error) {
	resp, err := agentCall(agentRequest{Op: agentOpKey})
	if errors.Is(err, errNoAgent) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if resp.Locked {
		return nil, nil
	}
	return resp.Key, nil
}

// agentStoreKey hands the stretched key to the agent, starting one when
// none is running. A zero timeout keeps whatever the agent was started with.
func agentStoreKey(key []byte, timeout time.Duration) (time.Time, error) {
	if err := ensureAgentRunning(timeout); err != nil {
		return time.Time{}, err
	}
	req := agentRequest{Op: agentOpUnlock, Key: key}
	if timeout > 0 {
		req.Timeout = timeout.String()
	}
	resp, err := agentCall(req)
	if err != nil {
		return time.Time{}, err
	}
	return resp.ExpiresAt, nil
}

// agentStoreKeyIfRunning refreshes a running agent after a successful
// prompt-based unlock and stays silent when there is no agent.
func agentStoreKeyIfRunning(key []byte) {
	if _, err := agentCall(agentRequest{Op: agentOpStatus}); err != nil {
		return
	}
	_, _ = agentCall(agentRequest{Op: agentOpUnlock, Key: key})
}

func agentLock() error {
	_, err := agentCall(agentRequest{Op: agentOpLock})
	if errors.Is(err, errNoAgent) {
		return nil
	}
	return err
}

// agentStatus reports (running, locked, expiresAt).
func agentStatus() (bool, bool, time.Time, error) {
	resp, err := agentCall(agentRequest{Op: agentOpStatus})
	if errors.Is(err, errNoAgent) {
		return false, true, time.Time{}, nil
	}
	if err != nil {
		return false, true, time.Time{}, err
	}
	return true, resp.Locked, resp.ExpiresAt, nil
}

// ensureAgentRunning spawns `vaultctl agent` detached from this terminal
// when the socket does not answer, then waits for it to come up.
func ensureAgentRunning(timeout time.Duration) error {
	if _, err := agentCall(agentRequest{Op: agentOpStatus}); err == nil {
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	args := []string{"agent"}
	if timeout > 0 {
		args = append(args, "--timeout", timeout.String())
	}
	child := exec.Command(exe, args...) //nolint:gosec // G204: re-executing our own binary
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	child.Stdin, child.Stdout, child.Stderr = nil, nil, nil
	if err := child.Start(); err != nil {
		return fmt.Errorf("start agent: %w", err)
	}
	if err := child.Process.Release(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		if _, err := agentCall(agentRequest{Op: agentOpStatus}); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return errors.New("agent did not start in time")
		case <-time.After(50 * time.Millisecond):
		}
	}
}
