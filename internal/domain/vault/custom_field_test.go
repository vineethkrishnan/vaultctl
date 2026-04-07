package vault

import (
	"errors"
	"testing"
)

func TestCustomFieldType(t *testing.T) {
	t.Parallel()
	want := []CustomFieldType{CustomFieldText, CustomFieldHidden, CustomFieldBoolean, CustomFieldLinked}
	if len(AllCustomFieldTypes()) != len(want) {
		t.Fatalf("wrong count")
	}
	for _, k := range want {
		got, err := ParseCustomFieldType(string(k))
		if err != nil || got != k {
			t.Fatalf("%q roundtrip failed: %v", k, err)
		}
		if !k.IsValid() || k.String() != string(k) {
			t.Fatalf("%q methods broken", k)
		}
	}
	for _, bad := range []string{"", "number", "Text"} {
		if _, err := ParseCustomFieldType(bad); !errors.Is(err, ErrInvalidCustomFieldType) {
			t.Fatalf("%q expected ErrInvalidCustomFieldType, got %v", bad, err)
		}
	}
	if CustomFieldType("bogus").IsValid() {
		t.Fatalf("bogus should not IsValid")
	}
}
