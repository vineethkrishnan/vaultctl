package cli

import "github.com/spf13/cobra"

// newClientCmds returns the subset of client-facing commands that can be
// implemented with server calls only (no client-side crypto derivation).
//
// Commands requiring master-password-to-authHash derivation (login, create,
// edit, get <with decryption>) need the TS crypto module from M6. In M10
// we ship them as documented skeletons so operators can shape their
// workflow now and fill the implementation in M6's follow-up pass.
func newClientCmds() []*cobra.Command {
	return []*cobra.Command{
		stubCmd("login", "Authenticate (interactive master-password prompt)"),
		stubCmd("logout", "End the current session"),
		stubCmd("status", "Show current session status"),
		stubCmd("list", "List items in the vault"),
		stubCmd("get", "Get an item field (password, username, totp, uri, notes)"),
		stubCmd("create", "Create a new vault item"),
		stubCmd("edit", "Update an existing item"),
		stubCmd("delete", "Soft-delete an item (move to trash)"),
		stubCmd("generate", "Generate a random password"),
		stubCmd("totp", "Print the current TOTP code for an item"),
		stubCmd("lock", "Lock the vault (clear session keys)"),
		stubCmd("unlock", "Unlock the vault (re-enter master password)"),
	}
}

func stubCmd(use, short string) *cobra.Command {
	return &cobra.Command{
		Use:   use,
		Short: short,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cmd.PrintErrf("command %q not yet implemented in M10 — depends on the client crypto module (M6).\n", use)
			cmd.PrintErrln("See docs/initial/architecture.md § Milestone 6.")
			return nil
		},
	}
}
