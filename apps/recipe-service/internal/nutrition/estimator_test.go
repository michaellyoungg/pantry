package nutrition

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"
)

func snapshotEstimator(t *testing.T) *Estimator {
	t.Helper()
	e := NewEstimator(testNormalizer{}, SnapshotProvider(), SnapshotNutrients())
	e.now = func() time.Time { return fixedTime }
	return e
}

func nutrient(t *testing.T, est Estimate, id string) float64 {
	t.Helper()
	n, ok := est.Nutrients[id]
	if !ok {
		t.Fatalf("nutrient %s missing from %+v", id, est.Nutrients)
	}
	return n.Amount
}

// TestGoldenRecipes runs whole recipes end to end against the checked-in
// snapshot, with the grams per line worked out by hand. It is the regression
// guard on the conversion path: change a portion weight or a conversion rule and
// one of these moves.
func TestGoldenRecipes(t *testing.T) {
	e := snapshotEstimator(t)

	t.Run("pancake batter", func(t *testing.T) {
		// 1 cup flour  = 125 g   2 eggs      = 100 g
		// 1 cup milk   = 244 g   2 tbsp butter = 28.4 g
		// 0.5 tsp salt = 3 g
		est := e.Estimate(context.Background(), []Line{
			{1, "cup", "flour"},
			{2, "", "eggs"},
			{1, "cup", "milk"},
			{2, "tbsp", "butter"},
			{0.5, "tsp", "salt"},
		}, 0)

		wantGrams := []float64{125, 100, 244, 28.4, 3}
		for i, want := range wantGrams {
			got := est.Ingredients[i]
			if got.Grams == nil || math.Abs(*got.Grams-want) > 0.01 {
				t.Errorf("%q: grams = %v, want %v (%s)", got.Item, got.Grams, want, got.Reason)
			}
		}

		// energy:      364*1.25 + 143*1.0 + 61*2.44 + 717*0.284 + 0
		if got := nutrient(t, est, "1008"); math.Abs(got-950.468) > 0.001 {
			t.Errorf("energy = %v, want 950.468", got)
		}
		// cholesterol: 372*1.0 + 10*2.44 + 215*0.284
		if got := nutrient(t, est, "1253"); math.Abs(got-457.46) > 0.001 {
			t.Errorf("cholesterol = %v, want 457.46", got)
		}
		// sodium:      2*1.25 + 142*1.0 + 43*2.44 + 643*0.284 + 38758*0.03
		if got := nutrient(t, est, "1093"); math.Abs(got-1594.772) > 0.001 {
			t.Errorf("sodium = %v, want 1594.772", got)
		}
		if est.Coverage.ResolvedMassFraction != 1 || est.Coverage.ResolvedCount != 5 {
			t.Errorf("coverage = %+v, want everything resolved", est.Coverage)
		}
	})

	t.Run("garlic butter with a synonym and a plural", func(t *testing.T) {
		est := e.Estimate(context.Background(), []Line{
			{4, "cloves", "garlic cloves"}, // synonym -> "garlic", plural unit -> "clove"
			{0.5, "cup", "butter"},         // 113.5 g
			{2, "tbsp", "fresh parsley"},   // alias -> parsley, 7.6 g
		}, 2)

		wantGrams := []float64{12, 113.5, 7.6}
		for i, want := range wantGrams {
			got := est.Ingredients[i]
			if got.Grams == nil || math.Abs(*got.Grams-want) > 0.01 {
				t.Errorf("%q: grams = %v, want %v (%s)", got.Item, got.Grams, want, got.Reason)
			}
		}
		// The yield is known here, so per-serving is exactly half the total.
		total, perServing := nutrient(t, est, "1008"), est.PerServing["1008"].Amount
		if math.Abs(total/2-perServing) > 0.001 {
			t.Errorf("per-serving %v is not half of total %v", perServing, total)
		}
		if est.Servings != 2 {
			t.Errorf("Servings = %v, want 2", est.Servings)
		}
	})

	t.Run("a recipe with gaps reports them", func(t *testing.T) {
		est := e.Estimate(context.Background(), []Line{
			{1, "cup", "rice"},       // 185 g, resolved
			{2, "tbsp", "gochujang"}, // no food match
			{1, "pinch", "saffron"},  // trace
			{200, "g", "tempeh"},     // mass known, nutrition unknown
		}, 4)

		if est.Coverage.ResolvedCount != 1 || est.Coverage.TotalCount != 4 {
			t.Errorf("coverage counts = %+v, want 1 of 4", est.Coverage)
		}
		// 185 resolved / (185 known + 200 known + 1 imputed at the median 192.5)
		if got := est.Coverage.ResolvedMassFraction; math.Abs(got-0.3205) > 0.0005 {
			t.Errorf("mass fraction = %v, want ~0.3205", got)
		}

		gochujang := est.Ingredients[1]
		if gochujang.Resolved || gochujang.Reason == "" {
			t.Errorf("unmatched line = %+v, want an unresolved row naming the problem", gochujang)
		}
		tempeh := est.Ingredients[3]
		if tempeh.Resolved || tempeh.Grams == nil || *tempeh.Grams != 200 {
			t.Errorf("weighed-but-unknown line = %+v, want 200 g and unresolved", tempeh)
		}
	})
}

// With no key and no snapshot hit, every line goes unresolved and coverage is 0.
// The one thing that must not happen is an error or a partial number presented
// as complete.
func TestEstimateWithoutAnyProvider(t *testing.T) {
	e := NewEstimator(testNormalizer{}, NullProvider{}, SnapshotNutrients())
	e.now = func() time.Time { return fixedTime }

	est := e.Estimate(context.Background(), []Line{
		{1, "cup", "flour"},
		{2, "", "eggs"},
	}, 4)

	if len(est.Nutrients) != 0 {
		t.Errorf("nutrients = %+v, want empty", est.Nutrients)
	}
	if est.Coverage.ResolvedMassFraction != 0 || est.Coverage.ResolvedCount != 0 || est.Coverage.TotalCount != 2 {
		t.Errorf("coverage = %+v, want nothing resolved out of 2", est.Coverage)
	}
	for _, ing := range est.Ingredients {
		if ing.Resolved || ing.Reason == "" {
			t.Errorf("%+v: want an unresolved row with a reason", ing)
		}
	}
}

// A provider that errors degrades the affected lines; it does not sink the
// request or poison the lines that did resolve.
func TestEstimateSurvivesAProviderError(t *testing.T) {
	src := &countingProvider{err: errors.New("fdc is down")}
	e := NewEstimator(testNormalizer{}, ChainProvider{src, SnapshotProvider()}, SnapshotNutrients())
	e.now = func() time.Time { return fixedTime }

	est := e.Estimate(context.Background(), []Line{{1, "cup", "flour"}}, 0)
	if est.Coverage.ResolvedCount != 1 {
		t.Errorf("coverage = %+v, want the snapshot to have carried the line", est.Coverage)
	}
}

func TestEstimateEmptyRecipe(t *testing.T) {
	est := snapshotEstimator(t).Estimate(context.Background(), nil, 4)
	if len(est.Ingredients) != 0 || est.Coverage.TotalCount != 0 {
		t.Errorf("got %+v, want an empty estimate", est)
	}
	if est.Nutrients == nil {
		t.Error("Nutrients must be an empty map, not nil")
	}
}
