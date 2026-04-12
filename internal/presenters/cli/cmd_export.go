package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/spf13/cobra"
)

func newExportCmd() *cobra.Command {
	var outFile string
	cmd := &cobra.Command{
		Use:   "export",
		Short: "Export all items as an encrypted JSON backup",
		Long: `Export all accessible vault items to a JSON file. Item data remains
encrypted — the export is safe to store on disk but useless without
the master password. If --out is omitted, output goes to stdout.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			session, err := LoadSession()
			if err != nil {
				return err
			}

			// Fetch the server-side export (items stay encrypted)
			raw, err := httpGet("/export", session)
			if err != nil {
				return err
			}

			// Wrap in an envelope with metadata
			var serverData json.RawMessage = raw
			envelope := map[string]any{
				"version":    1,
				"exportedAt": time.Now().UTC().Format(time.RFC3339),
				"data":       serverData,
			}

			out, err := json.MarshalIndent(envelope, "", "  ")
			if err != nil {
				return fmt.Errorf("marshal export: %w", err)
			}

			if outFile != "" {
				if err := os.WriteFile(outFile, out, 0600); err != nil {
					return fmt.Errorf("write file: %w", err)
				}
				if !isJSON(cmd) {
					_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Exported to %s (%d bytes)\n", outFile, len(out))
				}
				return nil
			}

			// Write to stdout
			_, err = cmd.OutOrStdout().Write(out)
			if err != nil {
				return err
			}
			_, _ = fmt.Fprintln(cmd.OutOrStdout())
			return nil
		},
	}
	cmd.Flags().StringVarP(&outFile, "out", "o", "", "Output file path (default: stdout)")
	return cmd
}
