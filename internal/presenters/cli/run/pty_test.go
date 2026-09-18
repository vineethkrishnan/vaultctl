// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin || linux

package run

import (
	"bytes"
	"context"
	"io"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"
)

// A getpass child is the smallest program that behaves like tsh, mysql
// and ssh: it turns echo off for the password and keeps it on for the
// rest.
const promptScript = `import getpass, sys
print("hello")
p = getpass.getpass("Enter password: ")
u = input("Username: ")
o = input("Enter OTP code: ")
print("RESULT", u, p, o)
sys.exit(3)`

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func (b *syncBuffer) waitFor(t *testing.T, needle string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(b.String(), needle) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("output never contained %q; got %q", needle, b.String())
}

func requirePython(t *testing.T) string {
	t.Helper()
	path, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not installed")
	}
	return path
}

func TestRun_FillsEveryPromptKindOnce(t *testing.T) {
	python := requirePython(t)
	var out, notices syncBuffer
	stdin, _ := io.Pipe()
	result, err := Run(context.Background(), Options{
		Argv: []string{python, "-u", "-c", promptScript},
		Values: map[Kind]func() (string, error){
			KindPassword: func() (string, error) { return "s3cret", nil },
			KindUsername: func() (string, error) { return "alice", nil },
			KindTOTP:     func() (string, error) { return "123456", nil },
		},
		Stdin:  stdin,
		Stdout: &out,
		Notice: func(msg string) { _, _ = notices.Write([]byte(msg + "\n")) },
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "RESULT alice s3cret 123456") {
		t.Errorf("child did not receive the fills: %q", out.String())
	}
	if strings.Contains(out.String(), "s3cret\r\n") && strings.Count(out.String(), "s3cret") != 1 {
		t.Errorf("password must not be echoed: %q", out.String())
	}
	if result.ExitCode != 3 {
		t.Errorf("exit code = %d", result.ExitCode)
	}
	wantFilled := []Kind{KindPassword, KindUsername, KindTOTP}
	if len(result.Filled) != 3 || result.Filled[0] != wantFilled[0] || result.Filled[1] != wantFilled[1] || result.Filled[2] != wantFilled[2] {
		t.Errorf("filled = %v", result.Filled)
	}
	if notices.String() != "" {
		t.Errorf("unexpected notices: %q", notices.String())
	}
}

func TestRun_HandsOverWhenAPromptRepeats(t *testing.T) {
	python := requirePython(t)
	script := `import getpass
a = getpass.getpass("Password: ")
b = getpass.getpass("Password: ")
print("RESULT", a, b)`
	var out, notices syncBuffer
	stdinReader, stdinWriter := io.Pipe()
	done := make(chan Result, 1)
	go func() {
		result, _ := Run(context.Background(), Options{
			Argv:   []string{python, "-u", "-c", script},
			Values: map[Kind]func() (string, error){KindPassword: func() (string, error) { return "first", nil }},
			Stdin:  stdinReader,
			Stdout: &out,
			Notice: func(msg string) { _, _ = notices.Write([]byte(msg + "\n")) },
		})
		done <- result
	}()
	notices.waitFor(t, "password prompt appeared again")
	_, _ = stdinWriter.Write([]byte("typed\r"))
	result := <-done
	if !strings.Contains(out.String(), "RESULT first typed") {
		t.Errorf("second prompt should be the user's: %q", out.String())
	}
	if len(result.Filled) != 1 {
		t.Errorf("filled = %v", result.Filled)
	}
}

func TestRun_CapturesWhatTheUserTypes(t *testing.T) {
	python := requirePython(t)
	var out syncBuffer
	stdinReader, stdinWriter := io.Pipe()
	done := make(chan Result, 1)
	go func() {
		result, _ := Run(context.Background(), Options{
			Argv:    []string{python, "-u", "-c", promptScript},
			Capture: true,
			Stdin:   stdinReader,
			Stdout:  &out,
		})
		done <- result
	}()
	out.waitFor(t, "Enter password: ")
	time.Sleep(secretSettle * 2)
	_, _ = stdinWriter.Write([]byte("hunter2\r"))
	out.waitFor(t, "Username: ")
	time.Sleep(visibleSettle * 2)
	_, _ = stdinWriter.Write([]byte("bob\x7f\x7fob\r"))
	out.waitFor(t, "Enter OTP code: ")
	time.Sleep(visibleSettle * 2)
	_, _ = stdinWriter.Write([]byte("654321\r"))
	result := <-done

	if !strings.Contains(out.String(), "RESULT bob hunter2 654321") {
		t.Errorf("child output: %q", out.String())
	}
	if result.Captured[KindPassword] != "hunter2" || result.Captured[KindUsername] != "bob" || result.Captured[KindTOTP] != "654321" {
		t.Errorf("captured = %v", result.Captured)
	}
	if len(result.Filled) != 0 {
		t.Errorf("capture mode must not fill: %v", result.Filled)
	}
}

func TestRun_LeavesUnknownPromptsAlone(t *testing.T) {
	python := requirePython(t)
	script := `a = input("Continue (yes/no)? ")
print("GOT", a)`
	var out syncBuffer
	stdinReader, stdinWriter := io.Pipe()
	done := make(chan Result, 1)
	go func() {
		result, _ := Run(context.Background(), Options{
			Argv: []string{python, "-u", "-c", script},
			Values: map[Kind]func() (string, error){
				KindUsername: func() (string, error) { return "never", nil },
			},
			Stdin:  stdinReader,
			Stdout: &out,
		})
		done <- result
	}()
	out.waitFor(t, "(yes/no)? ")
	time.Sleep(visibleSettle * 2)
	_, _ = stdinWriter.Write([]byte("yes\r"))
	result := <-done
	if !strings.Contains(out.String(), "GOT yes") || len(result.Filled) != 0 {
		t.Errorf("output %q filled %v", out.String(), result.Filled)
	}
}
