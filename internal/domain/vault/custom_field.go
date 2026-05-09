// SPDX-License-Identifier: AGPL-3.0-or-later

package vault

import (
	"errors"
	"fmt"
)

// CustomFieldType enumerates the field shapes a user can define on any item.
// Values are stored INSIDE the encrypted payload — the server NEVER sees
// them. The domain holds the enum so that import parsers and client UIs
// share one source of truth.
type CustomFieldType string

const (
	CustomFieldText    CustomFieldType = "text"    // plain text
	CustomFieldHidden  CustomFieldType = "hidden"  // rendered as password input
	CustomFieldBoolean CustomFieldType = "boolean" // true/false toggle
	CustomFieldLinked  CustomFieldType = "linked"  // URL reference
)

// ErrInvalidCustomFieldType signals an unknown custom-field kind.
var ErrInvalidCustomFieldType = errors.New("vault: invalid custom field type")

// AllCustomFieldTypes returns every supported CustomFieldType.
func AllCustomFieldTypes() []CustomFieldType {
	return []CustomFieldType{CustomFieldText, CustomFieldHidden, CustomFieldBoolean, CustomFieldLinked}
}

// ParseCustomFieldType validates a raw string.
func ParseCustomFieldType(raw string) (CustomFieldType, error) {
	t := CustomFieldType(raw)
	if !t.IsValid() {
		return "", fmt.Errorf("%w: %q", ErrInvalidCustomFieldType, raw)
	}
	return t, nil
}

// IsValid reports whether t is enumerated.
func (t CustomFieldType) IsValid() bool {
	for _, k := range AllCustomFieldTypes() {
		if k == t {
			return true
		}
	}
	return false
}

// String returns the canonical string.
func (t CustomFieldType) String() string { return string(t) }
