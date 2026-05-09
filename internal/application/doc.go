// SPDX-License-Identifier: AGPL-3.0-or-later

// Package application hosts use cases and the ports (interfaces) through
// which the domain reaches infrastructure.
//
// Application may only import domain. Use cases are tested with mocked ports;
// see PRD §14.3. Populated in M2 (auth) and M3 (vault).
package application
