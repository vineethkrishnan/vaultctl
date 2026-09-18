// SPDX-License-Identifier: AGPL-3.0-or-later

package run

import "strings"

// Rewrite adds the username to the command line for programs that never
// prompt for one (they default to the local user), and asks mysql to
// prompt for a password when the item has one. Nothing is added when the
// user already supplied the flag, and unknown programs are left alone.
func Rewrite(argv []string, target Target, username string, hasPassword bool) []string {
	if len(argv) == 0 {
		return argv
	}
	out := append([]string(nil), argv...)
	switch target.Program {
	case "tsh":
		if username != "" && len(out) > 1 && out[1] == "login" && !hasFlag(out, "--user") {
			out = append(out, "--user="+username)
		}
	case "mysql", "mariadb", "mysqldump", "mysqladmin":
		if username != "" && !hasFlag(out, "-u", "--user") {
			out = insertAfterProgram(out, "-u"+username)
		}
		if hasPassword && !hasFlag(out, "-p", "--password") {
			out = append(out, "-p")
		}
	case "ssh":
		if username != "" && !hasFlag(out, "-l") && !hasUserAtHost(out) {
			out = insertAfterProgram(out, "-l", username)
		}
	case "psql":
		if username != "" && !hasFlag(out, "-U", "--username") {
			out = insertAfterProgram(out, "-U", username)
		}
	}
	return out
}

// HasPasswordArg reports whether the command line already carries a
// password, in which case no fill should happen at all.
func HasPasswordArg(argv []string) bool {
	if len(argv) == 0 {
		return false
	}
	target := ParseArgv(argv)
	for _, token := range argv[1:] {
		if strings.HasPrefix(token, "--password=") {
			return true
		}
		switch target.Program {
		case "mysql", "mariadb", "mysqldump", "mysqladmin":
			if len(token) > 2 && strings.HasPrefix(token, "-p") && !strings.HasPrefix(token, "--") {
				return true
			}
		}
	}
	return false
}

func hasFlag(argv []string, flags ...string) bool {
	for _, token := range argv[1:] {
		for _, flag := range flags {
			if token == flag || strings.HasPrefix(token, flag+"=") {
				return true
			}
			if !strings.HasPrefix(flag, "--") && len(flag) == 2 && strings.HasPrefix(token, flag) && !strings.HasPrefix(token, "--") {
				return true
			}
		}
	}
	return false
}

func hasUserAtHost(argv []string) bool {
	for _, token := range argv[1:] {
		if !strings.HasPrefix(token, "-") && userAtHostRe.MatchString(token) {
			return true
		}
	}
	return false
}

func insertAfterProgram(argv []string, extra ...string) []string {
	out := make([]string, 0, len(argv)+len(extra))
	out = append(out, argv[0])
	out = append(out, extra...)
	return append(out, argv[1:]...)
}
