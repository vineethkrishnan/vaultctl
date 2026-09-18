// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin || linux

package cli

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/vineethkrishnan/vaultctl/internal/presenters/cli/run"
)

const totpMinRemaining = 3

func newRunCmd() *cobra.Command {
	var (
		itemName string
		dryRun   bool
		noFill   bool
		noSave   bool
	)
	cmd := &cobra.Command{
		Use:   "run [flags] -- <command> [args...]",
		Short: "Run a command and answer its login prompts from the vault",
		Long: `Run any interactive command inside a pseudo-terminal and answer its
username, password and one-time-code prompts from the vault, the way the
browser extension fills a login form.

The login item is picked by the host on the command line (--proxy=HOST,
user@HOST, https://HOST/..., -h HOST) and matched against the item's URI
exactly as the extension matches sites. A value the command line already
supplies is never filled, because the program does not prompt for it.

When no item matches, the command runs as usual and, if it succeeds, you
are offered to save what you typed as a new login. Programs whose
arguments name no host are remembered per command line after that.

Examples:
  vaultctl run -- tsh login --proxy=teleport.example.com
  vaultctl run -- mysql -h db.example.com -p
  vaultctl run -- ssh deploy@web01.example.com
  vaultctl run --item "GitHub" -- git push`,
		Args: cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, argv []string) error {
			return runWrapped(cmd, argv, runFlags{itemName: itemName, dryRun: dryRun, noFill: noFill, noSave: noSave})
		},
	}
	cmd.Flags().SetInterspersed(false)
	cmd.Flags().StringVar(&itemName, "item", "", "Use this login item instead of matching by host")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Show which item and fields would be used, then exit")
	cmd.Flags().BoolVar(&noFill, "no-fill", false, "Run in the pseudo-terminal without answering any prompt")
	cmd.Flags().BoolVar(&noSave, "no-save", false, "Never offer to save typed credentials")
	addVaultFlag(cmd)
	return cmd
}

type runFlags struct {
	itemName string
	dryRun   bool
	noFill   bool
	noSave   bool
}

func runWrapped(cmd *cobra.Command, argv []string, flags runFlags) error {
	target := run.ParseArgv(argv)
	host, _ := target.Host()
	interactive := term.IsTerminal(int(os.Stdin.Fd()))

	if flags.noFill || run.HasPasswordArg(argv) {
		if run.HasPasswordArg(argv) {
			printErr("vaultctl: password supplied on the command line, running without fill")
		}
		return execWrapped(cmd, argv, run.Options{}, interactive)
	}

	session, err := LoadSession()
	if err != nil {
		return err
	}
	keys, err := deriveSessionKeys(session)
	if err != nil {
		return err
	}
	defer keys.Zero()

	runMap, err := run.LoadRunMap()
	if err != nil {
		return err
	}
	signature := run.Signature(argv, nil)
	match, err := pickLogin(session, keys, target, runMap, signature, flags.itemName, interactive)
	if err != nil {
		return err
	}

	if match == nil {
		if flags.dryRun {
			return printDryRun(cmd, nil, target, argv)
		}
		result, err := runInPty(cmd, argv, run.Options{Capture: !flags.noSave && interactive}, interactive)
		if err != nil {
			return err
		}
		if result.ExitCode == 0 && !flags.noSave && interactive && len(result.Captured) > 0 {
			if err := offerSave(cmd, session, keys, target, host, signature, runMap, result.Captured); err != nil {
				printErr("vaultctl: " + err.Error())
			}
		}
		return exitWith(result.ExitCode)
	}

	if match.Item.Reprompt {
		if err := verifyMasterPassword(session); err != nil {
			return err
		}
	}
	argv = run.Rewrite(argv, target, match.Data.Username, match.Data.Password != "")
	if flags.dryRun {
		return printDryRun(cmd, match, target, argv)
	}
	return execWrapped(cmd, argv, run.Options{Values: valuesFor(match.Data)}, interactive)
}

func execWrapped(cmd *cobra.Command, argv []string, opts run.Options, interactive bool) error {
	result, err := runInPty(cmd, argv, opts, interactive)
	if err != nil {
		return err
	}
	return exitWith(result.ExitCode)
}

func runInPty(cmd *cobra.Command, argv []string, opts run.Options, interactive bool) (run.Result, error) {
	opts.Argv = argv
	opts.Stdin = os.Stdin
	opts.Stdout = os.Stdout
	opts.Notice = printErr
	if interactive {
		opts.Terminal = os.Stdin
	}
	ctx := cmd.Context()
	if ctx == nil {
		ctx = context.Background()
	}
	return run.Run(ctx, opts)
}

func exitWith(code int) error {
	if code == 0 {
		return nil
	}
	return exitCodeError{code: code}
}

// pickLogin resolves the item in this order: --item, the remembered choice
// for this command line, then the host on the command line. Several
// matches for one host go through a picker whose answer is remembered.
func pickLogin(session *Session, keys *Keys, target run.Target, runMap *run.RunMap, signature, itemName string, interactive bool) (*loginMatch, error) {
	if itemName != "" {
		match, err := findLoginByName(session, keys, itemName)
		if err != nil {
			return nil, err
		}
		return match, nil
	}
	if itemID := runMap.Get(signature); itemID != "" {
		if match := findLoginByID(session, keys, itemID); match != nil {
			return match, nil
		}
	}
	host, ok := target.Host()
	if !ok {
		return nil, nil
	}
	matches, err := findLoginsForHost(session, keys, host, target.Username())
	if err != nil {
		return nil, err
	}
	if len(matches) == 0 && target.Username() != "" {
		if matches, err = findLoginsForHost(session, keys, host, ""); err != nil {
			return nil, err
		}
	}
	switch len(matches) {
	case 0:
		return nil, nil
	case 1:
		return &matches[0], nil
	}
	if !interactive {
		return nil, fmt.Errorf("%d logins match %s; pass --item to choose one", len(matches), host)
	}
	options := make(map[string]int, len(matches))
	for index, match := range matches {
		options[fmt.Sprintf("%s (%s, %s)", match.Name, match.Data.Username, match.Vault.Name)] = index
	}
	chosen, err := promptSelect("Several logins match "+host, options)
	if err != nil {
		return nil, err
	}
	if err := runMap.Set(signature, matches[chosen].Item.ID); err != nil {
		printErr("vaultctl: could not remember the choice: " + err.Error())
	}
	return &matches[chosen], nil
}

func findLoginByName(session *Session, keys *Keys, name string) (*loginMatch, error) {
	for _, vaultMeta := range session.Vaults {
		vaultKey, ok := keys.VaultKeys[vaultMeta.ID]
		if !ok {
			continue
		}
		raw, err := httpGet("/vaults/"+vaultMeta.ID+"/items", session)
		if err != nil {
			return nil, err
		}
		var items []apiItem
		if err := unmarshalJSON(raw, &items); err != nil {
			return nil, err
		}
		item, err := findItemByName(items, vaultKey, name)
		if err != nil {
			continue
		}
		data, err := decryptItemData(vaultKey, item.EncryptedData)
		if err != nil {
			return nil, err
		}
		return &loginMatch{Vault: vaultMeta, Item: item, Name: name, Data: data}, nil
	}
	return nil, fmt.Errorf("item %q not found in any vault", name)
}

func findLoginByID(session *Session, keys *Keys, itemID string) *loginMatch {
	for _, vaultMeta := range session.Vaults {
		vaultKey, ok := keys.VaultKeys[vaultMeta.ID]
		if !ok {
			continue
		}
		raw, err := httpGet("/vaults/"+vaultMeta.ID+"/items/"+itemID, session)
		if err != nil {
			continue
		}
		var item apiItem
		if err := unmarshalJSON(raw, &item); err != nil || item.Trashed {
			continue
		}
		data, err := decryptItemData(vaultKey, item.EncryptedData)
		if err != nil {
			continue
		}
		name, _ := decryptItemName(vaultKey, item.EncryptedName)
		return &loginMatch{Vault: vaultMeta, Item: item, Name: name, Data: data}
	}
	return nil
}

// valuesFor exposes the item's fields lazily; the TOTP code is generated
// when the prompt appears and waits out the last seconds of a period so
// the code is not expired by the time the server checks it.
func valuesFor(data ItemData) map[run.Kind]func() (string, error) {
	values := map[run.Kind]func() (string, error){}
	if data.Username != "" {
		values[run.KindUsername] = func() (string, error) { return data.Username, nil }
	}
	if data.Password != "" {
		values[run.KindPassword] = func() (string, error) { return data.Password, nil }
	}
	if data.TOTP != "" {
		values[run.KindTOTP] = func() (string, error) {
			if remaining := totpSecondsRemaining(data.TOTP, time.Now()); remaining < totpMinRemaining {
				time.Sleep(time.Duration(remaining) * time.Second)
			}
			return totpCodeAt(data.TOTP, time.Now())
		}
	}
	return values
}

func verifyMasterPassword(session *Session) error {
	printErr("This item asks for the master password before use.")
	stretchedKey, err := promptStretchedKey(session)
	if err != nil {
		return err
	}
	defer zeroBytes(stretchedKey)
	keys, err := unlockKeys(session, stretchedKey)
	if err != nil {
		return err
	}
	keys.Zero()
	return nil
}

func printDryRun(cmd *cobra.Command, match *loginMatch, target run.Target, argv []string) error {
	out := cmd.OutOrStdout()
	if match == nil {
		host, _ := target.Host()
		if isJSON(cmd) {
			return printJSON(cmd, map[string]any{"item": nil, "host": host, "mode": "capture", "argv": argv})
		}
		_, _ = fmt.Fprintf(out, "No login matches %q; the command would run in capture mode.\n", host)
		return nil
	}
	fields := make([]string, 0, 3)
	for kind := range valuesFor(match.Data) {
		fields = append(fields, kind.String())
	}
	if isJSON(cmd) {
		return printJSON(cmd, map[string]any{
			"item": match.Name, "itemId": match.Item.ID, "vault": match.Vault.Name, "fields": fields, "argv": argv,
		})
	}
	_, _ = fmt.Fprintf(out, "Item:    %s (%s)\n", match.Name, match.Vault.Name)
	_, _ = fmt.Fprintf(out, "Fills:   %s\n", strings.Join(fields, ", "))
	_, _ = fmt.Fprintf(out, "Command: %s\n", strings.Join(argv, " "))
	return nil
}

// offerSave mirrors the extension's save bar: after a successful run in
// capture mode, store what was typed as a new login in the active vault.
func offerSave(cmd *cobra.Command, session *Session, keys *Keys, target run.Target, host, signature string, runMap *run.RunMap, captured map[run.Kind]string) error {
	if captured[run.KindPassword] == "" {
		return nil
	}
	label := host
	if label == "" {
		label = target.Program
	}
	save, err := promptConfirm("Save the login you just typed for " + label + " to the vault?")
	if err != nil || !save {
		return err
	}
	name, err := promptString("Item name", func(s string) error {
		if strings.TrimSpace(s) == "" {
			return errors.New("name cannot be empty")
		}
		return nil
	})
	if err != nil {
		return err
	}
	vaultMeta, err := resolveActiveVault(cmd, session)
	if err != nil {
		return err
	}
	vaultKey, ok := keys.VaultKeys[vaultMeta.ID]
	if !ok {
		return ErrLocked
	}
	username := captured[run.KindUsername]
	if username == "" {
		username = target.Username()
	}
	data := ItemData{Username: username, Password: captured[run.KindPassword], URI: host}
	encryptedName, err := encryptItemName(vaultKey, name)
	if err != nil {
		return err
	}
	encryptedData, err := encryptItemData(vaultKey, data)
	if err != nil {
		return err
	}
	raw, err := httpPost("/vaults/"+vaultMeta.ID+"/items", sealedItemBody(itemTypeLogin, encryptedName, encryptedData), session)
	if err != nil {
		return err
	}
	var created apiItem
	if err := unmarshalJSON(raw, &created); err != nil {
		return err
	}
	if host == "" {
		if err := runMap.Set(signature, created.ID); err != nil {
			return err
		}
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Saved %q to %s.\n", name, vaultMeta.Name)
	if captured[run.KindTOTP] != "" {
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), "The one-time code you typed is not a secret; add the TOTP secret to the item in the web app to fill it next time.")
	}
	return nil
}
