// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/olekukonko/tablewriter"
	"github.com/spf13/cobra"
)

// outputJSON is a root-level persistent flag driving whether commands emit
// structured JSON or human-oriented tables. Accessed via isJSON(cmd).
const outputJSONFlag = "json"

func isJSON(cmd *cobra.Command) bool {
	v, _ := cmd.Root().PersistentFlags().GetBool(outputJSONFlag)
	return v
}

// printJSON writes v as indented JSON to the command's configured stdout.
func printJSON(cmd *cobra.Command, v any) error {
	out := cmd.OutOrStdout()
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// printTable renders headers + rows to the command's stdout using
// tablewriter's default ASCII renderer.
func printTable(cmd *cobra.Command, headers []string, rows [][]string) error {
	out := cmd.OutOrStdout()
	table := tablewriter.NewWriter(out)
	table.Header(headers)
	for _, row := range rows {
		cells := make([]any, len(row))
		for i, cell := range row {
			cells[i] = cell
		}
		if err := table.Append(cells...); err != nil {
			return err
		}
	}
	return table.Render()
}

// printErr writes an error to stderr. Every CLI command funnels failures
// through the RunE return value so cobra prints "error:" uniformly, but
// some helpers still need direct stderr access.
func printErr(msg string) {
	fmt.Fprintln(os.Stderr, msg)
}
