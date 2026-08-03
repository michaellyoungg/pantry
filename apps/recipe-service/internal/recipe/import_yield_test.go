package recipe

import "testing"

func TestParseRecipeYield(t *testing.T) {
	tests := []struct {
		name string
		in   any
		want *int // nil means "not confidently a serving count"
	}{
		// The shapes schema.org actually ships.
		{"bare number", float64(4), intPtr(4)},
		{"integral float", 6.0, intPtr(6)},
		{"numeric string", "4", intPtr(4)},
		{"string with unit", "4 servings", intPtr(4)},
		{"singular unit", "1 serving", intPtr(1)},
		{"portions", "8 portions", intPtr(8)},
		{"people", "4 people", intPtr(4)},
		{"leading verb", "Serves 6", intPtr(6)},
		{"leading label", "Yield: 4 servings", intPtr(4)},
		{"hedged", "makes about 4 servings", intPtr(4)},
		{"trailing period", "4 servings.", intPtr(4)},
		{"parenthetical after unit", "4 servings (1 cup each)", intPtr(4)},

		// Ranges collapse to their lower bound.
		{"hyphen range", "4-6", intPtr(4)},
		{"spaced hyphen range", "4 - 6 servings", intPtr(4)},
		{"en dash range", "4–6 servings", intPtr(4)},
		{"word range", "4 to 6 servings", intPtr(4)},
		{"or range", "2 or 3 servings", intPtr(2)},

		// Arrays: first entry that parses wins.
		{"array of strings", []any{"4 servings"}, intPtr(4)},
		{"array skips junk", []any{"a handful", "6 servings"}, intPtr(6)},
		{"array of numbers", []any{float64(2)}, intPtr(2)},

		// QuantitativeValue.
		{"quantitative value", map[string]any{
			"@type": "QuantitativeValue", "value": float64(4),
		}, intPtr(4)},
		{"quantitative value with unit", map[string]any{
			"@type": "QuantitativeValue", "value": float64(4), "unitText": "servings",
		}, intPtr(4)},
		{"quantitative value string value", map[string]any{
			"@type": "QuantitativeValue", "value": "4",
		}, intPtr(4)},
		{"quantitative value non-serving unit", map[string]any{
			"@type": "QuantitativeValue", "value": float64(24), "unitText": "cookies",
		}, nil},

		// Yields that are not serving counts. Guessing here would silently
		// corrupt every downstream per-serving figure, so we stay unknown.
		{"loaf", "1 loaf", nil},
		{"pieces", "24 cookies", nil},
		{"dozen", "2 dozen", nil},
		{"volume", "4 cups", nil},
		{"pan size", "1 9-inch pie", nil},
		{"no number", "a few", nil},
		{"empty", "", nil},
		{"zero", "0 servings", nil},
		{"negative", "-2 servings", nil},
		{"fractional", "1.5 servings", nil},
		{"absurdly large", "5000 servings", nil},
		{"absent", nil, nil},
		{"wrong type", true, nil},
		{"empty array", []any{}, nil},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := parseRecipeYield(tc.in)
			switch {
			case tc.want == nil && got != nil:
				t.Fatalf("parseRecipeYield(%#v) = %d, want nil", tc.in, *got)
			case tc.want != nil && got == nil:
				t.Fatalf("parseRecipeYield(%#v) = nil, want %d", tc.in, *tc.want)
			case tc.want != nil && *got != *tc.want:
				t.Fatalf("parseRecipeYield(%#v) = %d, want %d", tc.in, *got, *tc.want)
			}
		})
	}
}

func intPtr(n int) *int { return &n }
