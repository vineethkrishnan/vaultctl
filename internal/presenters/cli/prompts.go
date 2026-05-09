// SPDX-License-Identifier: AGPL-3.0-or-later

package cli

import (
	"errors"

	"github.com/charmbracelet/huh"
)

// promptPassword renders a hidden-entry password input through huh. Used by
// login and unlock. Returns an error on empty input so callers never see a
// silently empty master password.
func promptPassword(title string) (string, error) {
	var pw string
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title(title).
				EchoMode(huh.EchoModePassword).
				Validate(func(s string) error {
					if s == "" {
						return errors.New("password cannot be empty")
					}
					return nil
				}).
				Value(&pw),
		),
	)
	if err := form.Run(); err != nil {
		return "", err
	}
	return pw, nil
}

// promptString is the plain text equivalent — used for the email field on
// `vaultctl login` when the user didn't pass --email.
func promptString(title string, validate func(string) error) (string, error) {
	var value string
	input := huh.NewInput().Title(title).Value(&value)
	if validate != nil {
		input = input.Validate(validate)
	}
	form := huh.NewForm(huh.NewGroup(input))
	if err := form.Run(); err != nil {
		return "", err
	}
	return value, nil
}

// promptConfirm returns true on confirm, false on cancel. Used by `delete`
// when --force is absent.
func promptConfirm(title string) (bool, error) {
	confirm := false
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().Title(title).Value(&confirm),
		),
	)
	if err := form.Run(); err != nil {
		return false, err
	}
	return confirm, nil
}

// promptSelect shows a single-select menu with the supplied options and
// returns the chosen value. The generic T must be comparable so huh can
// diff selection state.
func promptSelect[T comparable](title string, options map[string]T) (T, error) {
	var zero T
	var selected T
	selectWidget := huh.NewSelect[T]().Title(title).Value(&selected)
	opts := make([]huh.Option[T], 0, len(options))
	for label, val := range options {
		opts = append(opts, huh.NewOption(label, val))
	}
	selectWidget = selectWidget.Options(opts...)
	form := huh.NewForm(huh.NewGroup(selectWidget))
	if err := form.Run(); err != nil {
		return zero, err
	}
	return selected, nil
}
