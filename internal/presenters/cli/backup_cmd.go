package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/config"
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
			defer os.Remove(pgpass)

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
			return nil
		},
	}
	cmd.Flags().StringVar(&output, "output", "", "destination directory")
	return cmd
}

// writeTempPgpass creates a temporary .pgpass file with 0600 perms and returns
// its path. The caller must defer os.Remove.
func writeTempPgpass(host string, port int, dbname, user, password string) (string, error) {
	f, err := os.CreateTemp("", "vaultctl-pgpass-*")
	if err != nil {
		return "", fmt.Errorf("create temp pgpass: %w", err)
	}
	if err := f.Chmod(0o600); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", fmt.Errorf("chmod pgpass: %w", err)
	}
	// .pgpass format: hostname:port:database:username:password
	line := fmt.Sprintf("%s:%d:%s:%s:%s\n", host, port, dbname, user, password)
	if _, err := f.WriteString(line); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", fmt.Errorf("write pgpass: %w", err)
	}
	if err := f.Close(); err != nil {
		os.Remove(f.Name())
		return "", fmt.Errorf("close pgpass: %w", err)
	}
	return f.Name(), nil
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
