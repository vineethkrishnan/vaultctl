// Package postgres hosts the pgx/v5-backed adapters that implement the
// repository ports. Every query is parameterised (no string concat into
// SQL), and every item/folder query is keyed by (vault_id, id) so the
// H11 IDOR guard lives in SQL.
package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/config"
)

// Pool wraps pgxpool.Pool so the server can close it on shutdown.
type Pool struct {
	*pgxpool.Pool
}

// Connect opens a pgx connection pool from the loaded Config.
func Connect(ctx context.Context, cfg *config.Config) (*Pool, error) {
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName, cfg.DBSSLMode)

	poolCfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	poolCfg.MaxConns = 10
	poolCfg.MaxConnLifetime = 1 * time.Hour

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &Pool{Pool: pool}, nil
}
