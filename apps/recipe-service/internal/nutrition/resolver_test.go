package nutrition

import (
	"math"
	"strings"
	"testing"
)

// TestResolveGrams is the conversion table. Gram resolution from messy
// ingredient quantities is where this package's real complexity lives, so every
// path — mass, exact portion, density, count — and every documented failure gets
// a row.
func TestResolveGrams(t *testing.T) {
	r := NewResolver(testNormalizer{})

	tests := []struct {
		name    string
		line    Line
		food    Food
		matched bool

		wantGrams  float64 // compared to 2dp, mirroring the wire
		wantKnown  bool
		wantMethod string
		wantSolved bool
		wantTrace  bool
		wantReason string // substring
	}{
		// ── Mass: convertible without any food data at all ──────────────────
		{
			name: "grams pass through", line: Line{200, "g", "flour"}, food: testFlour, matched: true,
			wantGrams: 200, wantKnown: true, wantMethod: MethodMass, wantSolved: true,
		},
		{
			name: "kilograms", line: Line{1.5, "kg", "flour"}, food: testFlour, matched: true,
			wantGrams: 1500, wantKnown: true, wantMethod: MethodMass, wantSolved: true,
		},
		{
			name: "ounces", line: Line{8, "oz", "cheddar cheese"}, food: testCheddar, matched: true,
			wantGrams: 226.8, wantKnown: true, wantMethod: MethodMass, wantSolved: true,
		},
		{
			name: "pounds", line: Line{2, "lb", "cheddar cheese"}, food: testCheddar, matched: true,
			wantGrams: 907.18, wantKnown: true, wantMethod: MethodMass, wantSolved: true,
		},
		{
			name: "plural spelling of a mass unit", line: Line{2, "pounds", "cheddar cheese"}, food: testCheddar, matched: true,
			wantGrams: 907.18, wantKnown: true, wantMethod: MethodMass, wantSolved: true,
		},

		// ── Exact household measure the food publishes ──────────────────────
		{
			name: "cup of flour uses the published cup weight", line: Line{1, "cup", "flour"}, food: testFlour, matched: true,
			wantGrams: 125, wantKnown: true, wantMethod: MethodPortion, wantSolved: true,
		},
		{
			name: "fractional cup", line: Line{0.5, "cup", "flour"}, food: testFlour, matched: true,
			wantGrams: 62.5, wantKnown: true, wantMethod: MethodPortion, wantSolved: true,
		},
		{
			name: "count unit the food publishes", line: Line{2, "clove", "garlic"}, food: testGarlic, matched: true,
			wantGrams: 6, wantKnown: true, wantMethod: MethodPortion, wantSolved: true,
		},
		{
			name: "plural count unit normalizes", line: Line{3, "cloves", "garlic"}, food: testGarlic, matched: true,
			wantGrams: 9, wantKnown: true, wantMethod: MethodPortion, wantSolved: true,
		},
		{
			name: "teaspoon of salt", line: Line{1, "tsp", "salt"}, food: testSalt, matched: true,
			wantGrams: 6, wantKnown: true, wantMethod: MethodPortion, wantSolved: true,
		},
		{
			name: "slice", line: Line{2, "slices", "cheddar cheese"}, food: testCheddar, matched: true,
			wantGrams: 56, wantKnown: true, wantMethod: MethodPortion, wantSolved: true,
		},

		// ── Volume crossed to mass through a derived density ────────────────
		{
			// flour publishes only a cup: 125 g / 236.588 ml = 0.5283 g/ml.
			name: "tablespoons via density", line: Line{3, "tbsp", "flour"}, food: testFlour, matched: true,
			wantGrams: 23.44, wantKnown: true, wantMethod: MethodDensity, wantSolved: true,
		},
		{
			name: "teaspoon via density", line: Line{1, "tsp", "flour"}, food: testFlour, matched: true,
			wantGrams: 2.6, wantKnown: true, wantMethod: MethodDensity, wantSolved: true,
		},
		{
			name: "millilitres via density", line: Line{500, "ml", "milk"}, food: testMilk, matched: true,
			wantGrams: 515.66, wantKnown: true, wantMethod: MethodDensity, wantSolved: true,
		},
		{
			name: "litres via density", line: Line{1, "l", "milk"}, food: testMilk, matched: true,
			wantGrams: 1031.33, wantKnown: true, wantMethod: MethodDensity, wantSolved: true,
		},
		{
			// "fl oz" is not in the recipe dictionary; the resolver carries it
			// for FDC's benefit. It must never fold onto the mass unit "oz".
			name: "fluid ounces are volume, not mass", line: Line{2, "fl oz", "olive oil"}, food: testOil, matched: true,
			wantGrams: 54, wantKnown: true, wantMethod: MethodDensity, wantSolved: true,
		},

		// ── Countable lines with no unit ────────────────────────────────────
		{
			// egg publishes only "large"; a recipe that says "2 eggs" must still
			// land on a per-piece weight.
			name: "bare count falls back through the size words", line: Line{2, "", "eggs"}, food: testEgg, matched: true,
			wantGrams: 100, wantKnown: true, wantMethod: MethodCount, wantSolved: true,
		},
		{
			name: "explicit large", line: Line{3, "large", "eggs"}, food: testEgg, matched: true,
			wantGrams: 150, wantKnown: true, wantMethod: MethodPortion, wantSolved: true,
		},

		// ── Documented failures ─────────────────────────────────────────────
		{
			name: "trace measure", line: Line{1, "pinch", "salt"}, food: testSalt, matched: true,
			wantTrace: true, wantReason: "trace measure",
		},
		{
			name: "to taste with no quantity is trace, not a missing quantity",
			line: Line{0, "to taste", "black pepper"}, food: testSalt, matched: true,
			wantTrace: true, wantReason: "trace measure",
		},
		{
			name: "no quantity", line: Line{0, "cup", "flour"}, food: testFlour, matched: true,
			wantReason: "no quantity",
		},
		{
			name: "negative quantity", line: Line{-1, "cup", "flour"}, food: testFlour, matched: true,
			wantReason: "no quantity",
		},
		{
			name: "no food match", line: Line{1, "cup", "sumac"}, matched: false,
			wantReason: `no food match for "sumac"`,
		},
		{
			// The mass is knowable without a food. Nutrients are not. Counting
			// this as covered is exactly how an estimate ends up confidently
			// wrong, so the two facts stay separate.
			name: "weighed but unknown food keeps its mass and loses its nutrients",
			line: Line{200, "g", "sumac"}, matched: false,
			wantGrams: 200, wantKnown: true, wantMethod: MethodMass,
			wantReason: `no nutrition data for "sumac"`,
		},
		{
			name: "matched food with no nutrient vector is not resolved",
			line: Line{200, "g", "mystery powder"}, food: testMystery, matched: true,
			wantGrams: 200, wantKnown: true, wantMethod: MethodMass,
			wantReason: "no nutrition data",
		},
		{
			name: "count unit the food does not publish", line: Line{1, "head", "garlic"}, food: testGarlic, matched: true,
			wantReason: `no gram weight for unit "head"`,
		},
		{
			name: "bare count on a food with no per-piece weight", line: Line{3, "", "garlic"}, food: testGarlic, matched: true,
			wantReason: `no per-piece gram weight for "garlic"`,
		},
		{
			name: "volume on a food with no volume portion", line: Line{1, "cup", "mystery powder"}, food: testMystery, matched: true,
			wantReason: `no gram weight for a volume of "mystery powder"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := r.Resolve(tt.line, tt.food, tt.matched)

			if got.GramsKnown != tt.wantKnown {
				t.Fatalf("GramsKnown = %v, want %v (reason %q)", got.GramsKnown, tt.wantKnown, got.Reason)
			}
			if tt.wantKnown && math.Abs(round(got.Grams, 2)-tt.wantGrams) > 1e-9 {
				t.Errorf("Grams = %v, want %v", round(got.Grams, 2), tt.wantGrams)
			}
			if got.Method != tt.wantMethod {
				t.Errorf("Method = %q, want %q", got.Method, tt.wantMethod)
			}
			if got.Resolved() != tt.wantSolved {
				t.Errorf("Resolved() = %v, want %v", got.Resolved(), tt.wantSolved)
			}
			if got.Trace != tt.wantTrace {
				t.Errorf("Trace = %v, want %v", got.Trace, tt.wantTrace)
			}
			if tt.wantReason != "" && !strings.Contains(got.Reason, tt.wantReason) {
				t.Errorf("Reason = %q, want it to contain %q", got.Reason, tt.wantReason)
			}
			if tt.wantSolved && got.Reason != "" {
				t.Errorf("resolved line carries reason %q", got.Reason)
			}
		})
	}
}

// TestResolvePrefersPublishedPortionOverDensity guards the ordering: USDA's
// measured cup weight beats one we divide our way to.
func TestResolvePrefersPublishedPortionOverDensity(t *testing.T) {
	r := NewResolver(testNormalizer{})
	// A deliberately inconsistent food: its tbsp is not 1/16 of its cup.
	food := Food{
		Nutrients: map[string]float64{"1008": 100},
		Portions:  map[string]float64{"cup": 240, "tbsp": 20},
	}
	got := r.Resolve(Line{1, "tbsp", "x"}, food, true)
	if got.Method != MethodPortion || got.Grams != 20 {
		t.Fatalf("got %v g by %q, want 20 g by %q", got.Grams, got.Method, MethodPortion)
	}
}

// TestResolveDensityPrefersLargestMeasure: a cup's published weight carries less
// relative rounding error than a teaspoon's, so it is the one a density comes
// from.
func TestResolveDensityPrefersLargestMeasure(t *testing.T) {
	r := NewResolver(testNormalizer{})
	food := Food{
		Nutrients: map[string]float64{"1008": 100},
		Portions:  map[string]float64{"cup": 236.588, "tsp": 10},
	}
	got := r.Resolve(Line{100, "ml", "x"}, food, true)
	if got.Method != MethodDensity {
		t.Fatalf("Method = %q, want %q", got.Method, MethodDensity)
	}
	if math.Abs(got.Grams-100) > 0.01 {
		t.Fatalf("Grams = %v, want ~100 (density from the cup, not the tsp)", got.Grams)
	}
}

func TestPortionKey(t *testing.T) {
	tests := []struct{ in, want string }{
		{"cup", "cup"},
		{"Cups", "cup"},
		{"tablespoon", "tbsp"},
		{"Tablespoons", "tbsp"},
		{"tsp.", "tsp"},
		{"teaspoons", "tsp"},
		{"cloves", "clove"},
		{"leaves", "leaf"},
		{"", ""},
		// FDC's own spellings.
		{"cup, chopped", "cup"},
		{"cup, sliced", "cup"},
		{`medium (2-1/2" dia)`, "medium"},
		{"1 medium", "medium"},
		{"1/2 cup", "cup"},
		{"1-1/2 tbsp", "tbsp"},
		{"undetermined", ""},
		{"1", ""},
		// Mass and volume must never collide.
		{"fl oz", "fl oz"},
		{"fluid ounces", "fl oz"},
		{"ounces", "oz"},
		{"lbs", "lb"},
		// An unenumerated measure still keys consistently.
		{"wedges", "wedge"},
		{"wedge", "wedge"},
	}
	for _, tt := range tests {
		if got := portionKey(tt.in); got != tt.want {
			t.Errorf("portionKey(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestIsTraceMeasure(t *testing.T) {
	for _, u := range []string{"pinch", "Pinch", "dash", "to taste", " as needed "} {
		if !isTraceMeasure(u) {
			t.Errorf("isTraceMeasure(%q) = false, want true", u)
		}
	}
	for _, u := range []string{"cup", "g", "", "clove"} {
		if isTraceMeasure(u) {
			t.Errorf("isTraceMeasure(%q) = true, want false", u)
		}
	}
}
