package nutrition

import (
	"encoding/json"
	"testing"
	"time"
)

var fixedTime = time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)

func resolve(t *testing.T, line Line, food Food, matched bool) Resolution {
	t.Helper()
	return NewResolver(testNormalizer{}).Resolve(line, food, matched)
}

func TestComputeTotals(t *testing.T) {
	res := []Resolution{
		resolve(t, Line{1, "cup", "flour"}, testFlour, true), // 125 g
		resolve(t, Line{2, "", "eggs"}, testEgg, true),       // 100 g
	}
	est := Compute(res, testNutrients(), 0, fixedTime)

	// flour: 364 kcal/100 g * 125 g = 455; egg: 143 * 1.0 = 143.
	if got := est.Nutrients["1008"].Amount; got != 598 {
		t.Errorf("energy = %v, want 598", got)
	}
	if got := est.Nutrients["1008"].Unit; got != "kcal" {
		t.Errorf("energy unit = %q, want kcal", got)
	}
	// protein only exists on the flour: 10.33 * 1.25 = 12.9125.
	if got := est.Nutrients["1003"].Amount; got != 12.913 {
		t.Errorf("protein = %v, want 12.913", got)
	}
	// cholesterol only exists on the egg: 372 * 1.0.
	if got := est.Nutrients["1253"].Amount; got != 372 {
		t.Errorf("cholesterol = %v, want 372", got)
	}
	if est.Coverage != (Coverage{ResolvedMassFraction: 1, ResolvedCount: 2, TotalCount: 2}) {
		t.Errorf("coverage = %+v, want fully covered", est.Coverage)
	}
	if !est.EstimatedAt.Equal(fixedTime) {
		t.Errorf("EstimatedAt = %v, want %v", est.EstimatedAt, fixedTime)
	}
}

func TestComputePerServing(t *testing.T) {
	res := []Resolution{resolve(t, Line{1, "cup", "flour"}, testFlour, true)} // 455 kcal

	t.Run("divides by the yield", func(t *testing.T) {
		est := Compute(res, testNutrients(), 4, fixedTime)
		if got := est.PerServing["1008"].Amount; got != 113.75 {
			t.Errorf("per-serving energy = %v, want 113.75", got)
		}
		if est.Nutrients["1008"].Amount != 455 {
			t.Errorf("totals must be unaffected by the division")
		}
		if est.Servings != 4 {
			t.Errorf("Servings = %v, want 4", est.Servings)
		}
	})

	// The design is explicit: totals still come back, but a per-serving figure
	// derived from a guessed yield would be confidently wrong.
	for _, servings := range []float64{0, -1} {
		t.Run("omitted when the yield is unknown", func(t *testing.T) {
			est := Compute(res, testNutrients(), servings, fixedTime)
			if est.PerServing != nil {
				t.Errorf("servings=%v: PerServing = %+v, want nil", servings, est.PerServing)
			}
			if est.Nutrients["1008"].Amount != 455 {
				t.Errorf("servings=%v: totals must still be returned", servings)
			}
		})
	}
}

func TestComputeCoverage(t *testing.T) {
	flour := func() Resolution { return resolve(t, Line{1, "cup", "flour"}, testFlour, true) } // 125 g

	tests := []struct {
		name         string
		res          []Resolution
		wantFraction float64
		wantResolved int
		wantTotal    int
	}{
		{
			name:         "everything resolved",
			res:          []Resolution{flour(), flour()},
			wantFraction: 1, wantResolved: 2, wantTotal: 2,
		},
		{
			// A pinch of salt should not knock a fifth off a recipe's
			// confidence, so trace measures are excluded from the imputed mass.
			name:         "a trace measure does not dent coverage",
			res:          []Resolution{flour(), resolve(t, Line{1, "pinch", "salt"}, testSalt, true)},
			wantFraction: 1, wantResolved: 1, wantTotal: 2,
		},
		{
			// An unresolvable line of unknown mass is imputed at the median
			// known line — 125 g here — so it lands at half.
			name:         "an unresolvable line is imputed at the median",
			res:          []Resolution{flour(), resolve(t, Line{1, "cup", "sumac"}, Food{}, false)},
			wantFraction: 0.5, wantResolved: 1, wantTotal: 2,
		},
		{
			// Known mass, no nutrition: the denominator gets its true weight, so
			// this is exact rather than imputed. 125 / (125+100).
			name:         "a weighed line with no nutrition data uses its real mass",
			res:          []Resolution{flour(), resolve(t, Line{100, "g", "sumac"}, Food{}, false)},
			wantFraction: 0.5556, wantResolved: 1, wantTotal: 2,
		},
		{
			name:         "nothing resolved",
			res:          []Resolution{resolve(t, Line{1, "cup", "sumac"}, Food{}, false)},
			wantFraction: 0, wantResolved: 0, wantTotal: 1,
		},
		{
			name:         "no ingredients at all",
			res:          nil,
			wantFraction: 0, wantResolved: 0, wantTotal: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Compute(tt.res, testNutrients(), 0, fixedTime).Coverage
			want := Coverage{ResolvedMassFraction: tt.wantFraction, ResolvedCount: tt.wantResolved, TotalCount: tt.wantTotal}
			if got != want {
				t.Errorf("coverage = %+v, want %+v", got, want)
			}
		})
	}
}

// TestComputeIsPure: same inputs, same output, no hidden clock or global state.
func TestComputeIsPure(t *testing.T) {
	res := []Resolution{resolve(t, Line{1, "cup", "flour"}, testFlour, true)}
	a, _ := json.Marshal(Compute(res, testNutrients(), 2, fixedTime))
	b, _ := json.Marshal(Compute(res, testNutrients(), 2, fixedTime))
	if string(a) != string(b) {
		t.Fatalf("Compute is not deterministic:\n%s\n%s", a, b)
	}
}

// TestComputeCarriesUnknownNutrients pins decision 1 of the design: the vector
// is an open map. A nutrient we have no reference row for still reaches the
// wire, because adding one must be a data change and never a code change.
func TestComputeCarriesUnknownNutrients(t *testing.T) {
	food := Food{
		Description: "Something",
		Nutrients:   map[string]float64{"9999": 42},
		Portions:    map[string]float64{"cup": 100},
	}
	est := Compute([]Resolution{resolve(t, Line{1, "cup", "x"}, food, true)}, testNutrients(), 0, fixedTime)
	got, ok := est.Nutrients["9999"]
	if !ok {
		t.Fatalf("uncatalogued nutrient was dropped: %+v", est.Nutrients)
	}
	if got.Amount != 42 || got.NutrientID != "9999" || got.Unit != "" {
		t.Errorf("got %+v, want amount 42 with an empty unit", got)
	}
}

func TestComputeProvenance(t *testing.T) {
	est := Compute([]Resolution{
		resolve(t, Line{1, "cup", "flour"}, testFlour, true),
		resolve(t, Line{1, "bunch", "sumac"}, Food{}, false),
	}, testNutrients(), 0, fixedTime)

	if len(est.Ingredients) != 2 {
		t.Fatalf("got %d ingredient rows, want 2", len(est.Ingredients))
	}
	resolved := est.Ingredients[0]
	if !resolved.Resolved || resolved.Grams == nil || *resolved.Grams != 125 {
		t.Errorf("resolved row = %+v, want 125 g resolved", resolved)
	}
	if resolved.Method != MethodPortion || resolved.MatchedFood != testFlour.Description {
		t.Errorf("resolved row lost its provenance: %+v", resolved)
	}
	missing := est.Ingredients[1]
	if missing.Resolved || missing.Grams != nil || missing.Reason == "" {
		t.Errorf("unresolved row = %+v, want nil grams and a reason", missing)
	}
	if missing.MatchedFood != "" {
		t.Errorf("unmatched row claims a food: %q", missing.MatchedFood)
	}
}

// TestEstimateJSONShape pins the wire contract BL-0037..BL-0040 build on.
func TestEstimateJSONShape(t *testing.T) {
	est := Compute([]Resolution{resolve(t, Line{1, "cup", "flour"}, testFlour, true)}, testNutrients(), 2, fixedTime)
	raw, err := json.Marshal(est)
	if err != nil {
		t.Fatal(err)
	}
	var back map[string]any
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"nutrients", "perServing", "servings", "coverage", "ingredients", "estimatedAt"} {
		if _, ok := back[key]; !ok {
			t.Errorf("missing %q in %s", key, raw)
		}
	}
	cov, _ := back["coverage"].(map[string]any)
	for _, key := range []string{"resolvedMassFraction", "resolvedCount", "totalCount"} {
		if _, ok := cov[key]; !ok {
			t.Errorf("missing coverage.%s in %s", key, raw)
		}
	}

	// Empty collections must marshal as {} and [], not null: a client that has
	// to null-check every field is a client that will forget to.
	empty, err := json.Marshal(Compute(nil, testNutrients(), 0, fixedTime))
	if err != nil {
		t.Fatal(err)
	}
	var emptyBack struct {
		Nutrients   map[string]NutrientAmount `json:"nutrients"`
		PerServing  *map[string]any           `json:"perServing"`
		Ingredients []IngredientEstimate      `json:"ingredients"`
	}
	if err := json.Unmarshal(empty, &emptyBack); err != nil {
		t.Fatal(err)
	}
	if emptyBack.Nutrients == nil || emptyBack.Ingredients == nil {
		t.Errorf("empty estimate marshalled nulls: %s", empty)
	}
	if emptyBack.PerServing != nil {
		t.Errorf("perServing should be absent when the yield is unknown: %s", empty)
	}
}
