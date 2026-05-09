// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/lib/pq"
	"github.com/spf13/cobra"

	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/config"
	dbmigrations "github.com/vineethkrishnan/vaultctl/migrations"
)

func newMigrateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "migrate",
		Short: "Database migrations (embedded)",
	}
	cmd.AddCommand(newMigrateUpCmd(), newMigrateDownCmd())
	return cmd
}

func newMigrateUpCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "up",
		Short: "Apply all pending migrations",
		RunE: func(cmd *cobra.Command, _ []string) error {
			m, closeFn, err := newMigrator()
			if err != nil {
				return err
			}
			defer closeFn()
			if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
				return fmt.Errorf("migrate up: %w", err)
			}
			version, dirty, err := m.Version()
			if err != nil && !errors.Is(err, migrate.ErrNilVersion) {
				return fmt.Errorf("read version: %w", err)
			}
			cmd.Printf("migrations applied: version=%d dirty=%t\n", version, dirty)
			return nil
		},
	}
}

func newMigrateDownCmd() *cobra.Command {
	var steps int
	c := &cobra.Command{
		Use:   "down",
		Short: "Roll back N migrations (default 1)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			m, closeFn, err := newMigrator()
			if err != nil {
				return err
			}
			defer closeFn()
			if err := m.Steps(-steps); err != nil && !errors.Is(err, migrate.ErrNoChange) {
				return fmt.Errorf("migrate down: %w", err)
			}
			cmd.Printf("rolled back %d step(s)\n", steps)
			return nil
		},
	}
	c.Flags().IntVar(&steps, "steps", 1, "Number of migrations to roll back")
	return c
}

func newMigrator() (*migrate.Migrate, func(), error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, fmt.Errorf("load config: %w", err)
	}
	src, err := iofs.New(dbmigrations.FS, ".")
	if err != nil {
		return nil, nil, fmt.Errorf("open embedded migrations: %w", err)
	}
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName, cfg.DBSSLMode)
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, nil, fmt.Errorf("open db: %w", err)
	}
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		_ = db.Close()
		return nil, nil, fmt.Errorf("postgres driver: %w", err)
	}
	m, err := migrate.NewWithInstance("iofs", src, "postgres", driver)
	if err != nil {
		_ = db.Close()
		return nil, nil, fmt.Errorf("migrator: %w", err)
	}
	return m, func() { _, _ = m.Close() }, nil
}
