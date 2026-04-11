package cli

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/vineethkrishnan/vaultctl/internal/application/audit"
	"github.com/vineethkrishnan/vaultctl/internal/application/ports"
	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/config"
	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/postgres"
)

func newBackupCmd() *cobra.Command {
	var output string
	cmd := &cobra.Command{
		Use:   "backup",
		Short: "Create an encrypted PostgreSQL dump of the vaultctl database",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			if output == "" {
				output = "/backups"
			}
			// M2: refuse if .env sits inside the backup dir.
			if err := assertKeySeparation(output); err != nil {
				return err
			}
			if err := os.MkdirAll(output, 0o700); err != nil {
				return fmt.Errorf("mkdir backup dir: %w", err)
			}
			filename := filepath.Join(output, fmt.Sprintf("vaultctl-%s.dump", time.Now().UTC().Format("20060102-150405")))

			// Write a temp .pgpass file to avoid leaking the password in
			// the process environment (visible via ps aux).
			pgpass, err := writeTempPgpass(cfg.DBHost, cfg.DBPort, cfg.DBName, cfg.DBUser, cfg.DBPassword)
			if err != nil {
				return err
			}
			defer os.Remove(pgpass) //nolint:errcheck // best-effort cleanup

			args := []string{
				"-h", cfg.DBHost, "-p", fmt.Sprint(cfg.DBPort),
				"-U", cfg.DBUser, "-d", cfg.DBName,
				"-Fc", "-f", filename, "--no-password",
			}
			pgDump := exec.CommandContext(cmd.Context(), "pg_dump", args...)
			pgDump.Env = append(os.Environ(), "PGPASSFILE="+pgpass)
			pgDump.Stdout = cmd.OutOrStdout()
			pgDump.Stderr = cmd.ErrOrStderr()
			if err := pgDump.Run(); err != nil {
				return fmt.Errorf("pg_dump: %w", err)
			}
			cmd.Printf("backup written to %s\n", filename)

			// Prune dumps older than VAULTCTL_BACKUP_RETENTION_DAYS (M12).
			// Retention <= 0 disables pruning so operators can opt out.
			if cfg.BackupRetentionDays > 0 {
				pruned, err := pruneOldBackups(output, cfg.BackupRetentionDays, time.Now())
				if err != nil {
					// Don't fail the backup run on cleanup errors —
					// the dump itself is already safe on disk.
					cmd.PrintErrf("warning: retention cleanup failed: %v\n", err)
				} else if pruned > 0 {
					cmd.Printf("pruned %d backup(s) older than %d days\n", pruned, cfg.BackupRetentionDays)
				}
			}

			// Best-effort audit log entry (M13). The CLI has no HTTP
			// context, so user_id / ip / user_agent are empty. Any
			// error here must NOT fail the backup.
			writeBackupAuditEntry(cmd.Context(), cfg)
			return nil
		},
	}
	cmd.Flags().StringVar(&output, "output", "", "destination directory")
	return cmd
}

// pruneOldBackups deletes vaultctl-*.dump files in dir whose mtime is older
// than retentionDays from now. Returns the count of files removed.
// Files that don't match the vaultctl- prefix are left alone.
func pruneOldBackups(dir string, retentionDays int, now time.Time) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, fmt.Errorf("read backup dir: %w", err)
	}
	cutoff := now.Add(-time.Duration(retentionDays) * 24 * time.Hour)
	removed := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasPrefix(name, "vaultctl-") || !strings.HasSuffix(name, ".dump") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			if err := os.Remove(filepath.Join(dir, name)); err != nil {
				return removed, fmt.Errorf("remove %s: %w", name, err)
			}
			removed++
		}
	}
	return removed, nil
}

// writeTempPgpass creates a temporary .pgpass file with 0600 perms and returns
// its path. The caller must defer os.Remove.
func writeTempPgpass(host string, port int, dbname, user, password string) (string, error) {
	f, err := os.CreateTemp("", "vaultctl-pgpass-*")
	if err != nil {
		return "", fmt.Errorf("create temp pgpass: %w", err)
	}
	cleanup := func() {
		_ = f.Close()
		_ = os.Remove(f.Name())
	}
	if err := f.Chmod(0o600); err != nil {
		cleanup()
		return "", fmt.Errorf("chmod pgpass: %w", err)
	}
	// .pgpass format: hostname:port:database:username:password
	line := fmt.Sprintf("%s:%d:%s:%s:%s\n", host, port, dbname, user, password)
	if _, err := f.WriteString(line); err != nil {
		cleanup()
		return "", fmt.Errorf("write pgpass: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(f.Name())
		return "", fmt.Errorf("close pgpass: %w", err)
	}
	return f.Name(), nil
}

// writeBackupAuditEntry opens a short-lived pool, writes a single
// backup.run audit row, and closes. Any failure is logged and swallowed
// — an audit miss must never fail the backup operation itself.
func writeBackupAuditEntry(ctx context.Context, cfg *config.Config) {
	pool, err := postgres.Connect(ctx, cfg)
	if err != nil {
		slog.Default().WarnContext(ctx, "audit connect failed", slog.Any("error", err))
		return
	}
	defer pool.Close()
	repo := &postgres.AuditRepo{Pool: pool}
	writer := audit.New(repo, ports.RealClock(), slog.Default())
	writer.BackupRun(ctx, "", "", "vaultctl-cli/backup")
}

// assertKeySeparation refuses to write a backup if the directory contains
// ANY .env* file. Enforces the M2 hard rule ("backup and server keys MUST
// live in different locations with different access policies").
func assertKeySeparation(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // will be created, nothing to guard yet
		}
		return err
	}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".env") {
			return fmt.Errorf("refusing to back up: %s contains %q — per M2, server keys MUST NOT live alongside DB backups", dir, name)
		}
	}
	return nil
}
