package contract

import (
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"pantry/apps/recipe-service/internal/recipe"
)

// field is one JSON property, reduced to what both sides can state: its name,
// a coarse kind, whether it is always present, and whether it can be null.
//
// The kinds are deliberately coarse. A schema and a Go struct agree on "array"
// but not on whether the element type is a $ref, so pretending to check more
// than this would be a check that lies. What it does catch is every drift that
// has actually happened here: a renamed field, a field one side forgot, a
// number that became a string, and an optional that became required.
type field struct {
	Name     string
	Kind     string
	Required bool
	Nullable bool
}

// binding is one schema and the Go type that serves it.
type binding struct {
	Schema string
	Go     reflect.Type
	// Strict is false for request-only schemas. A struct the server only ever
	// DECODES says nothing about what a client must send — `omitempty` is an
	// encoding hint and Go fills an absent field with its zero value — so for
	// those, names and kinds are checked and optionality is not.
	Strict bool
	Fields []field
}

func bind(schema string, goType reflect.Type, strict bool, fields ...field) binding {
	return binding{Schema: schema, Go: goType, Strict: strict, Fields: fields}
}

// TestStructsMatchSpec is the whole point of this package: every Go type the
// spec names must marshal to the shape the spec promises.
func TestStructsMatchSpec(t *testing.T) {
	// A generated table that came out empty would make every subtest below
	// vanish and the package pass, which is the one failure this test cannot
	// report on its own.
	if len(specBindings) == 0 {
		t.Fatal("spec_gen_test.go bound no Go types; run `pnpm contract:codegen`")
	}
	for _, b := range specBindings {
		t.Run(b.Schema+"/"+b.Go.String(), func(t *testing.T) {
			if b.Go.Kind() != reflect.Struct {
				t.Fatalf("%s is bound to %s, which is not a struct", b.Schema, b.Go)
			}
			for _, problem := range compare(b.Fields, jsonShape(b.Go), b.Strict) {
				t.Errorf("%s vs %s: %s", b.Schema, b.Go, problem)
			}
		})
	}
}

// TestRoutesMatchSpec fails when an endpoint is added to the router without
// being written down, or written down without being served. Either way a client
// generated from the spec is wrong about the surface it is calling.
func TestRoutesMatchSpec(t *testing.T) {
	got := recipe.RoutePatterns()
	if !slices.Equal(specRoutes, got) {
		t.Errorf("router and contract/openapi.yaml disagree:\n  spec:   %v\n  router: %v",
			specRoutes, got)
	}
}

// jsonShape reduces a Go struct to the JSON fields encoding/json would write.
func jsonShape(t reflect.Type) []field {
	out := []field{}
	for i := range t.NumField() {
		sf := t.Field(i)
		tag := sf.Tag.Get("json")
		if tag == "-" {
			continue
		}
		// An untagged embedded struct is spliced into the parent object, which
		// is how recipe.EquipmentMatch is "a Recipe plus three fields".
		// encoding/json promotes through an unexported struct type too, so this
		// is checked before the exportedness gate below.
		if sf.Anonymous && tag == "" && deref(sf.Type).Kind() == reflect.Struct {
			out = append(out, jsonShape(deref(sf.Type))...)
			continue
		}
		if !sf.IsExported() {
			continue
		}

		name, opts, _ := strings.Cut(tag, ",")
		if name == "" {
			name = sf.Name
		}
		omitempty := slices.Contains(strings.Split(opts, ","), "omitempty")

		ft := sf.Type
		nullable := false
		if ft.Kind() == reflect.Pointer {
			// A pointer without omitempty encodes nil as JSON null; with it, the
			// field simply disappears. Only the first is a nullable field.
			nullable = !omitempty
			ft = ft.Elem()
		}
		out = append(out, field{Name: name, Kind: kindOf(ft), Required: !omitempty, Nullable: nullable})
	}
	return out
}

func deref(t reflect.Type) reflect.Type {
	if t.Kind() == reflect.Pointer {
		return t.Elem()
	}
	return t
}

// kindOf names the JSON type a Go type encodes to, in the spec's vocabulary.
func kindOf(t reflect.Type) string {
	if t == reflect.TypeOf(time.Time{}) {
		return "string"
	}
	switch t.Kind() {
	case reflect.String:
		return "string"
	case reflect.Bool:
		return "boolean"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return "integer"
	case reflect.Float32, reflect.Float64:
		return "number"
	case reflect.Slice, reflect.Array:
		return "array"
	case reflect.Map, reflect.Struct:
		return "object"
	default:
		return "unsupported:" + t.Kind().String()
	}
}

// compare reports every way the two shapes differ, rather than the first, so a
// failing test names the whole drift instead of one field per run.
//
// Order is not compared: JSON object member order is not part of the contract,
// and requiring the spec to list fields in Go declaration order would turn a
// cosmetic edit into a test failure.
func compare(want, got []field, strict bool) []string {
	problems := []string{}
	byName := make(map[string]field, len(got))
	for _, f := range got {
		byName[f.Name] = f
	}

	for _, w := range want {
		g, ok := byName[w.Name]
		if !ok {
			problems = append(problems, fmt.Sprintf("%q is in the spec but not on the Go struct", w.Name))
			continue
		}
		if w.Kind != g.Kind {
			problems = append(problems, fmt.Sprintf("%q is %s in the spec, %s in Go", w.Name, w.Kind, g.Kind))
		}
		if strict && w.Required != g.Required {
			problems = append(problems, fmt.Sprintf("%q is %s in the spec, %s in Go",
				w.Name, presence(w.Required), presence(g.Required)))
		}
		if strict && w.Nullable != g.Nullable {
			problems = append(problems, fmt.Sprintf("%q is %s in the spec, %s in Go",
				w.Name, nullability(w.Nullable), nullability(g.Nullable)))
		}
	}

	inSpec := make(map[string]bool, len(want))
	for _, w := range want {
		inSpec[w.Name] = true
	}
	for _, g := range got {
		if !inSpec[g.Name] {
			problems = append(problems, fmt.Sprintf("%q is on the Go struct but not in the spec", g.Name))
		}
	}
	return problems
}

func presence(required bool) string {
	if required {
		return "required"
	}
	return "optional"
}

func nullability(nullable bool) string {
	if nullable {
		return "nullable"
	}
	return "non-null"
}

// ── The checker's own tests ───────────────────────────────────────────────
//
// specBindings only exercises jsonShape on shapes that currently AGREE, so
// nothing above would notice if the reflection quietly stopped seeing
// omitempty. These cover the cases the real structs depend on.

type embedded struct {
	Inner string `json:"inner"`
}

type shapeFixture struct {
	embedded
	Plain      string             `json:"plain"`
	Renamed    string             `json:"wire"`
	Omitted    string             `json:"omitted,omitempty"`
	Untagged   int                `json:""`
	Ignored    string             `json:"-"`
	unexported string             //nolint:unused // present to prove it is skipped
	NullNum    *float64           `json:"nullNum"`
	OptNum     *int               `json:"optNum,omitempty"`
	Stamp      time.Time          `json:"stamp"`
	Amounts    map[string]float64 `json:"amounts"`
	Items      []string           `json:"items"`
	Flag       bool               `json:"flag"`
}

func TestJSONShapeReadsTheTagsThatMatter(t *testing.T) {
	want := []field{
		{"inner", "string", true, false},
		{"plain", "string", true, false},
		{"wire", "string", true, false},
		{"omitted", "string", false, false},
		{"Untagged", "integer", true, false},
		{"nullNum", "number", true, true},
		{"optNum", "integer", false, false},
		{"stamp", "string", true, false},
		{"amounts", "object", true, false},
		{"items", "array", true, false},
		{"flag", "boolean", true, false},
	}
	got := jsonShape(reflect.TypeOf(shapeFixture{}))
	if !slices.Equal(want, got) {
		t.Errorf("jsonShape mismatch:\n want %v\n  got %v", want, got)
	}
}

func TestCompareNamesEveryDifference(t *testing.T) {
	want := []field{
		{"kept", "string", true, false},
		{"missing", "string", true, false},
		{"retyped", "integer", true, false},
		{"loosened", "string", false, false},
		{"nulled", "number", true, true},
	}
	got := []field{
		{"kept", "string", true, false},
		{"retyped", "string", true, false},
		{"loosened", "string", true, false},
		{"nulled", "number", true, false},
		{"extra", "string", true, false},
	}

	problems := compare(want, got, true)
	if len(problems) != 5 {
		t.Fatalf("expected one problem per difference, got %d: %v", len(problems), problems)
	}
	for _, fragment := range []string{"missing", "retyped", "loosened", "nulled", "extra"} {
		if !slices.ContainsFunc(problems, func(p string) bool { return strings.Contains(p, fragment) }) {
			t.Errorf("no problem mentions %q: %v", fragment, problems)
		}
	}
}

// A request-only binding must not fail merely because the server decodes a
// field the client may omit — Go fills an absent field with its zero value.
func TestCompareIgnoresOptionalityForRequests(t *testing.T) {
	want := []field{{"useItUp", "boolean", false, false}}
	got := []field{{"useItUp", "boolean", true, false}}

	if problems := compare(want, got, false); len(problems) != 0 {
		t.Errorf("request comparison should ignore optionality, got %v", problems)
	}
	if problems := compare(want, got, true); len(problems) != 1 {
		t.Errorf("response comparison should report it, got %v", problems)
	}
}
