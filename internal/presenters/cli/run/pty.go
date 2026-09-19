// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin || linux

package run

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"golang.org/x/sys/unix"
	"golang.org/x/term"
)

// Options configures one wrapped run.
type Options struct {
	Argv []string
	// Values answers prompts by kind. A nil function for a kind, or a nil
	// map, leaves that prompt to the user. Values are produced lazily so a
	// TOTP code is generated when the prompt appears, not before.
	Values map[Kind]func() (string, error)
	// Capture records what the user types into recognised prompts so the
	// caller can offer to save it. Only sensible when Values is nil.
	Capture bool
	// Terminal, when set, is put into raw mode for the duration and its
	// window size is mirrored into the pty.
	Terminal *os.File
	Stdin    io.Reader
	Stdout   io.Writer
	// Notice receives one-line status messages meant for stderr.
	Notice func(string)
}

// Result is what happened during the run.
type Result struct {
	ExitCode int
	Filled   []Kind
	Captured map[Kind]string
}

const (
	secretSettle  = 80 * time.Millisecond
	visibleSettle = 150 * time.Millisecond
	tickInterval  = 30 * time.Millisecond
	tailLimit     = 2048
)

// Run executes argv inside a pseudo-terminal, proxying the user's terminal
// to it, and answers credential prompts as they appear. The wrapped
// program stays fully interactive; only the prompts the vault can answer
// are written on the user's behalf, each kind at most once.
func Run(ctx context.Context, opts Options) (Result, error) {
	if len(opts.Argv) == 0 {
		return Result{}, errors.New("run: empty command")
	}
	if opts.Stdin == nil {
		opts.Stdin = os.Stdin
	}
	if opts.Stdout == nil {
		opts.Stdout = os.Stdout
	}
	if opts.Notice == nil {
		opts.Notice = func(string) {}
	}

	command := exec.CommandContext(ctx, opts.Argv[0], opts.Argv[1:]...) //nolint:gosec // G204: running the user's own command line is the point
	master, err := startInPty(command, opts.Terminal)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = master.Close() }()

	if opts.Terminal != nil {
		restore, err := makeRaw(opts.Terminal)
		if err == nil {
			defer restore()
		}
		stopResize := mirrorWindowSize(opts.Terminal, master)
		defer stopResize()
	}

	session := &promptSession{
		opts: opts, master: master,
		answered: map[Kind]bool{}, handedOver: map[Kind]bool{}, captured: map[Kind]string{},
	}
	go session.pumpStdin()

	output := make(chan []byte, 16)
	go func() {
		defer close(output)
		buffer := make([]byte, 4096)
		for {
			n, err := master.Read(buffer)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buffer[:n])
				output <- chunk
			}
			if err != nil {
				return
			}
		}
	}()

	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()
	for output != nil {
		select {
		case chunk, ok := <-output:
			if !ok {
				output = nil
				continue
			}
			_, _ = opts.Stdout.Write(chunk)
			session.observe(chunk)
			session.evaluate(time.Now())
		case now := <-ticker.C:
			session.evaluate(now)
		}
	}

	result := Result{Filled: session.filled, Captured: session.captured}
	waitErr := command.Wait()
	var exitErr *exec.ExitError
	switch {
	case waitErr == nil:
		result.ExitCode = 0
	case errors.As(waitErr, &exitErr):
		result.ExitCode = exitErr.ExitCode()
		if status, ok := exitErr.Sys().(syscall.WaitStatus); ok && status.Signaled() {
			result.ExitCode = 128 + int(status.Signal())
		}
	default:
		return result, waitErr
	}
	return result, nil
}

func startInPty(command *exec.Cmd, terminal *os.File) (*os.File, error) {
	if terminal != nil {
		if size, err := pty.GetsizeFull(terminal); err == nil {
			return pty.StartWithSize(command, size)
		}
	}
	return pty.Start(command)
}

func makeRaw(terminal *os.File) (func(), error) {
	fd := int(terminal.Fd())
	if !term.IsTerminal(fd) {
		return func() {}, errors.New("not a terminal")
	}
	previous, err := term.MakeRaw(fd)
	if err != nil {
		return func() {}, err
	}
	return func() { _ = term.Restore(fd, previous) }, nil
}

func mirrorWindowSize(terminal, master *os.File) func() {
	resized := make(chan os.Signal, 1)
	signal.Notify(resized, syscall.SIGWINCH)
	go func() {
		for range resized {
			_ = pty.InheritSize(terminal, master)
		}
	}()
	return func() {
		signal.Stop(resized)
		close(resized)
	}
}

// promptSession tracks the child's output tail and terminal mode to spot
// prompts, and either answers them or records what the user types.
type promptSession struct {
	opts   Options
	master *os.File

	mu          sync.Mutex
	tail        []byte
	lastOutput  time.Time
	tailHandled bool
	wasSecret   bool
	filled      []Kind
	answered    map[Kind]bool
	handedOver  map[Kind]bool

	captureOpen   bool
	captureSecret bool
	captureKind   Kind
	captureBuffer []byte
	captured      map[Kind]string
}

func (s *promptSession) observe(chunk []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tail = append(s.tail, chunk...)
	if len(s.tail) > tailLimit {
		s.tail = s.tail[len(s.tail)-tailLimit:]
	}
	s.lastOutput = time.Now()
	s.tailHandled = false
}

// evaluate is the detector: a canonical-mode read with echo off is a
// secret prompt (every password prompt looks like this, whatever the
// program); a visible prompt is output that stopped without a newline and
// reads like a question for a username or a code.
//
// Each burst of child output is acted on at most once (tailHandled, reset
// by observe), so a repeated prompt is recognised by its fresh output
// rather than by catching the brief echo-on window between two reads, which
// can be shorter than the sample tick.
func (s *promptSession) evaluate(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	secret := isSecretRead(s.master)
	if secret && !s.wasSecret && s.opts.Capture {
		s.openCapture(KindNone, true)
	}
	s.wasSecret = secret
	if s.lastOutput.IsZero() || s.tailHandled {
		return
	}
	quiet := now.Sub(s.lastOutput)
	switch {
	case secret && quiet >= secretSettle && !s.isEmptyAftermath():
		s.tailHandled = true
		s.handle(Classify(LastLine(s.tail), true), true)
	case !secret && quiet >= visibleSettle && len(s.tail) > 0 && s.tail[len(s.tail)-1] != '\n':
		s.tailHandled = true
		if kind := Classify(LastLine(s.tail), false); kind != KindNone {
			s.handle(kind, false)
		}
	}
}

// isEmptyAftermath is true when the only output since a fill is whitespace
// (getpass writes a newline after reading the secret), so that trailing
// newline is not mistaken for a fresh silent prompt.
func (s *promptSession) isEmptyAftermath() bool {
	return len(s.filled) > 0 && strings.TrimSpace(StripANSI(string(s.tail))) == ""
}

func (s *promptSession) handle(kind Kind, secret bool) {
	if s.opts.Capture {
		s.openCapture(kind, secret)
		return
	}
	if s.handedOver[kind] {
		return
	}
	if s.answered[kind] {
		s.handedOver[kind] = true
		s.opts.Notice(fmt.Sprintf("vaultctl: %s prompt appeared again, the vault value was not accepted; type it yourself", kind))
		return
	}
	produce := s.opts.Values[kind]
	if produce == nil {
		return
	}
	value, err := produce()
	if err != nil {
		s.opts.Notice("vaultctl: " + err.Error())
		return
	}
	if _, err := s.master.Write([]byte(value + "\r")); err != nil {
		s.opts.Notice("vaultctl: could not write " + kind.String() + ": " + err.Error())
		return
	}
	s.answered[kind] = true
	s.filled = append(s.filled, kind)
	s.tail = nil
}

func (s *promptSession) openCapture(kind Kind, secret bool) {
	if s.captureOpen && s.captureSecret == secret {
		if kind != KindNone {
			s.captureKind = kind
		}
		return
	}
	s.captureOpen = true
	s.captureSecret = secret
	s.captureKind = kind
	s.captureBuffer = s.captureBuffer[:0]
}

// pumpStdin forwards the user's keystrokes to the child and, while a
// recognised prompt is open in capture mode, keeps a copy of the line.
func (s *promptSession) pumpStdin() {
	buffer := make([]byte, 1024)
	for {
		n, err := s.opts.Stdin.Read(buffer)
		if n > 0 {
			s.recordInput(buffer[:n])
			if _, werr := s.master.Write(buffer[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func (s *promptSession) recordInput(input []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.captureOpen {
		return
	}
	for _, b := range input {
		switch {
		case b == '\r' || b == '\n':
			s.closeCapture()
			return
		case b == 0x03:
			s.captureOpen = false
			return
		case b == 0x7f || b == 0x08:
			if len(s.captureBuffer) > 0 {
				s.captureBuffer = s.captureBuffer[:len(s.captureBuffer)-1]
			}
		case b == 0x15:
			s.captureBuffer = s.captureBuffer[:0]
		case b >= 0x20:
			s.captureBuffer = append(s.captureBuffer, b)
		}
	}
}

func (s *promptSession) closeCapture() {
	kind := s.captureKind
	if kind == KindNone {
		kind = Classify(LastLine(s.tail), s.captureSecret)
	}
	if kind != KindNone && len(s.captureBuffer) > 0 {
		if _, taken := s.captured[kind]; !taken {
			s.captured[kind] = string(s.captureBuffer)
		}
	}
	for i := range s.captureBuffer {
		s.captureBuffer[i] = 0
	}
	s.captureBuffer = s.captureBuffer[:0]
	s.captureOpen = false
	s.captureKind = KindNone
}

// isSecretRead reports whether the child has the pty in canonical mode
// with echo off, which is how getpass-style prompts read a password.
// Full-screen and readline programs switch canonical mode off too, so
// they never register as a secret prompt.
func isSecretRead(master *os.File) bool {
	termios, err := unix.IoctlGetTermios(int(master.Fd()), ioctlReadTermios)
	if err != nil {
		return false
	}
	return termios.Lflag&unix.ECHO == 0 && termios.Lflag&unix.ICANON != 0
}
