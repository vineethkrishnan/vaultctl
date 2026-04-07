package cli

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/config"
	"github.com/vineethkrishnan/vaultctl/internal/infrastructure/logging"
)

// ServerRunner is injected by main.go so the CLI can call back into the
// HTTP-server bootstrap without this package importing it directly (the
// wiring lives in cmd/server, which would otherwise create a cycle).
type ServerRunner func(ctx context.Context, cfg *config.Config, addr string) (http.Handler, func() error, error)

var serverRunner ServerRunner

// RegisterServerRunner lets main.go plug in the wiring.
func RegisterServerRunner(r ServerRunner) { serverRunner = r }

func newServerCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "server",
		Short: "Start the vaultctl API server",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if serverRunner == nil {
				return errors.New("server runner not registered")
			}
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			logger := logging.New(cfg)

			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
			handler, cleanup, err := serverRunner(ctx, cfg, addr)
			if err != nil {
				return err
			}
			defer cleanup() //nolint:errcheck // best-effort shutdown cleanup

			srv := &http.Server{
				Addr:              addr,
				Handler:           handler,
				ReadHeaderTimeout: 10 * time.Second,
				ReadTimeout:       30 * time.Second,
				WriteTimeout:      30 * time.Second,
				IdleTimeout:       120 * time.Second,
			}
			errCh := make(chan error, 1)
			go func() {
				logger.Info("server.listening", "addr", addr)
				if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
					errCh <- err
				}
				close(errCh)
			}()
			select {
			case err := <-errCh:
				return fmt.Errorf("server: %w", err)
			case <-ctx.Done():
				logger.Info("server.shutting_down")
			}
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			return srv.Shutdown(shutdownCtx)
		},
	}
}

// newHealthCheckCmd is a dedicated sub-command that hits the local /health
// endpoint. Used by the Docker HEALTHCHECK directive.
func newHealthCheckCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:    "healthcheck",
		Short:  "Probe the local API health endpoint",
		Hidden: true,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			url := fmt.Sprintf("http://127.0.0.1:%d/api/v1/health", cfg.Port)
			resp, err := http.Get(url)
			if err != nil {
				return err
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				return fmt.Errorf("health check failed: %s", resp.Status)
			}
			return nil
		},
	}
	return cmd
}
