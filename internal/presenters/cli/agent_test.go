// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin || linux

package cli

import (
	"bytes"
	"context"
	"os"
	"testing"
	"time"
)

// startTestAgent serves an agent on a short-path socket (macOS caps unix
// socket paths at 104 bytes, which t.TempDir exceeds) for the test's
// lifetime and points the client helpers at it.
func startTestAgent(t *testing.T, timeout time.Duration) {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "vcagent")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	t.Setenv("XDG_RUNTIME_DIR", dir)
	socketPath, err := agentSocketPath()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- runAgent(ctx, socketPath, timeout) }()
	t.Cleanup(func() {
		cancel()
		if err := <-done; err != nil {
			t.Errorf("agent exited with: %v", err)
		}
	})
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := agentCall(agentRequest{Op: agentOpStatus}); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("agent did not come up")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestAgent_UnlockFetchLockRoundTrip(t *testing.T) {
	startTestAgent(t, time.Hour)
	key := bytes.Repeat([]byte{0xAB}, 32)

	if got, err := agentFetchKey(); err != nil || got != nil {
		t.Fatalf("fresh agent should be locked: key=%v err=%v", got, err)
	}
	running, locked, _, err := agentStatus()
	if err != nil || !running || !locked {
		t.Fatalf("status: running=%v locked=%v err=%v", running, locked, err)
	}

	expires, err := agentStoreKey(key, 0)
	if err != nil {
		t.Fatal(err)
	}
	if time.Until(expires) < 50*time.Minute {
		t.Errorf("expiry should honour the agent's own timeout, got %v", expires)
	}
	got, err := agentFetchKey()
	if err != nil || !bytes.Equal(got, key) {
		t.Fatalf("fetch after unlock: key=%x err=%v", got, err)
	}
	if err := agentLock(); err != nil {
		t.Fatal(err)
	}
	if got, err := agentFetchKey(); err != nil || got != nil {
		t.Fatalf("after lock: key=%v err=%v", got, err)
	}
}

func TestAgent_IdleTimeoutForgetsTheKey(t *testing.T) {
	startTestAgent(t, time.Hour)
	key := bytes.Repeat([]byte{0x01}, 32)
	if _, err := agentStoreKey(key, 80*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	if got, _ := agentFetchKey(); got == nil {
		t.Fatal("key should still be cached right after unlock")
	}
	time.Sleep(120 * time.Millisecond)
	if got, _ := agentFetchKey(); got != nil {
		t.Fatal("key should be gone after the idle timeout")
	}
}

func TestAgent_FetchExtendsTheIdleTimer(t *testing.T) {
	startTestAgent(t, time.Hour)
	if _, err := agentStoreKey(bytes.Repeat([]byte{0x02}, 32), 120*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	for range 4 {
		time.Sleep(60 * time.Millisecond)
		if got, _ := agentFetchKey(); got == nil {
			t.Fatal("regular use should keep the key alive")
		}
	}
}

func TestAgent_NoAgentIsNotAnError(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "vcnoagent")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	t.Setenv("XDG_RUNTIME_DIR", dir)

	if got, err := agentFetchKey(); err != nil || got != nil {
		t.Errorf("fetch without agent: key=%v err=%v", got, err)
	}
	if err := agentLock(); err != nil {
		t.Errorf("lock without agent: %v", err)
	}
	running, locked, _, err := agentStatus()
	if err != nil || running || !locked {
		t.Errorf("status without agent: running=%v locked=%v err=%v", running, locked, err)
	}
}

func TestHandleAgentRequest_Validation(t *testing.T) {
	state := &agentState{timeout: time.Minute}
	if resp := handleAgentRequest(state, agentRequest{Op: agentOpUnlock, Key: []byte("short")}); resp.Error == "" {
		t.Error("short key should be rejected")
	}
	if resp := handleAgentRequest(state, agentRequest{Op: agentOpUnlock, Key: make([]byte, 32), Timeout: "soon"}); resp.Error == "" {
		t.Error("bad timeout should be rejected")
	}
	if resp := handleAgentRequest(state, agentRequest{Op: "steal"}); resp.Error == "" {
		t.Error("unknown op should be rejected")
	}
	if got, _ := state.fetch(); got != nil {
		t.Error("rejected requests must not unlock the state")
	}
}
