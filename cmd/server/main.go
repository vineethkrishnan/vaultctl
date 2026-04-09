// Command vaultctl is the unified CLI + server entry point.
//
// Subcommands:
//   - vaultctl server       Start the API server
//   - vaultctl backup       Create a PostgreSQL dump
//   - vaultctl healthcheck  Probe /api/v1/health (used by container HEALTHCHECK)
//   - vaultctl admin init   Bootstrap the first admin user
//   - vaultctl <client>     Client commands (login, get, list, create, …) — M6 needed

// @title vaultctl API
// @version 1.0
// @description Zero-knowledge, self-hosted password vault API
// @host localhost:8080
// @BasePath /api/v1
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description Enter "Bearer {token}" (include the word Bearer)
package main

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/config"
	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/logging"
	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/scheduler"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/api"
	"github.com/vineethkrishnan/vaultctl/internal/presenters/cli"
)

func main() {
	// Register the server runner so `vaultctl server` can reach back into
	// the composition root without creating an import cycle.
	cli.RegisterServerRunner(runServer)
	cli.Execute()
}

// runServer is the composition root invoked by `vaultctl server`.
func runServer(ctx context.Context, cfg *config.Config, _ string) (http.Handler, func() error, error) {
	slog.SetDefault(logging.New(cfg))
	adapters, err := buildAdapters(ctx, cfg)
	if err != nil {
		return nil, nil, err
	}
	deps := buildHandlers(cfg, adapters)

	sched := scheduler.New(adapters.items, adapters.sess, cfg.TrashRetentionDays)
	sched.Start()

	cleanup := func() error {
		schedCtx := sched.Stop()
		<-schedCtx.Done()
		adapters.pool.Close()
		return nil
	}
	return api.NewRouter(deps), cleanup, nil
}
