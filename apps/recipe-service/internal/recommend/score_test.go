package recommend

import (
	"math"
	"testing"
)

func closeTo(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestCombineAveragesByWeight(t *testing.T) {
	// 3*1.0 + 1*0.0 = 3, over weight 4 => 0.75
	got := combine([]feature{
		{name: "a", value: 1.0, weight: 3, available: true},
		{name: "b", value: 0.0, weight: 1, available: true},
	})
	closeTo(t, got, 0.75)
}

// The core degradation guarantee: an unavailable feature leaves the score of
// the remaining features untouched. It must not count as a zero.
func TestCombineIgnoresUnavailableFeatures(t *testing.T) {
	withAll := combine([]feature{
		{name: "a", value: 1.0, weight: 3, available: true},
		{name: "b", value: 0.5, weight: 1, available: false},
	})
	onlyAvailable := combine([]feature{
		{name: "a", value: 1.0, weight: 3, available: true},
	})
	closeTo(t, withAll, onlyAvailable)
	closeTo(t, withAll, 1.0)
}

func TestCombineReturnsZeroWhenNothingAvailable(t *testing.T) {
	closeTo(t, combine([]feature{{name: "a", value: 1, weight: 1, available: false}}), 0)
	closeTo(t, combine(nil), 0)
}

// Penalties are negative values, so the raw sum can leave [0,1]. Clamp.
func TestCombineClampsToUnitInterval(t *testing.T) {
	closeTo(t, combine([]feature{{name: "p", value: -1, weight: 1, available: true}}), 0)
	closeTo(t, combine([]feature{{name: "p", value: 2, weight: 1, available: true}}), 1)
}

// Weights are a product decision, not an implementation detail. Pinning them
// means a tuning change shows up as an intentional diff in review.
func TestDefaultPantryWeightsArePinned(t *testing.T) {
	want := Weights{
		UseItUpHits:      3.0,
		Coverage:         2.0,
		MissingNonStaple: 1.0,
		Affinity:         1.0,
		RecentlyPlanned:  1.0,
		NutritionFit:     2.0,
	}
	if DefaultPantryWeights != want {
		t.Fatalf("pantry weights changed: got %+v, want %+v\n"+
			"If this change is intentional, update the expectation in this test.", DefaultPantryWeights, want)
	}
}
