package nutrition

import (
	"context"
	"errors"
	"math"
	"testing"
)

func TestEstimateGroupsSumsTheParts(t *testing.T) {
	e := snapshotEstimator(t)
	ctx := context.Background()

	a := []Line{{1, "cup", "flour"}, {2, "", "eggs"}}
	b := []Line{{1, "cup", "milk"}}

	one := e.Estimate(ctx, a, 0)
	two := e.Estimate(ctx, b, 0)
	combined, groups := e.EstimateGroups(ctx, []Group{{ID: "a", Lines: a}, {ID: "b", Lines: b}})

	want := nutrient(t, one, "1008") + nutrient(t, two, "1008")
	if got := nutrient(t, combined, "1008"); math.Abs(got-want) > 0.01 {
		t.Errorf("combined energy = %v, want %v", got, want)
	}
	if len(combined.Ingredients) != 3 {
		t.Errorf("ingredients = %d, want 3 (every line keeps its own provenance)", len(combined.Ingredients))
	}
	if got := combined.Coverage.TotalCount; got != 3 {
		t.Errorf("total count = %d, want 3", got)
	}
	// A rollup is not a recipe: there is no yield to divide by, so per-serving is
	// omitted rather than invented.
	if combined.PerServing != nil {
		t.Errorf("perServing = %v, want nil for a rollup", combined.PerServing)
	}

	if len(groups) != 2 {
		t.Fatalf("groups = %d, want 2", len(groups))
	}
	if groups[0].ID != "a" || groups[1].ID != "b" {
		t.Errorf("group ids = %q/%q, want a/b in call order", groups[0].ID, groups[1].ID)
	}
	for i, g := range groups {
		if g.Coverage.ResolvedMassFraction < 0.99 {
			t.Errorf("group %d coverage = %v, want ~1", i, g.Coverage.ResolvedMassFraction)
		}
	}
}

// The point of per-group coverage: one bad dish must be nameable, not blended
// away into a single percentage that looks merely "a bit low".
func TestEstimateGroupsIsolatesAnUnresolvableRecipe(t *testing.T) {
	e := snapshotEstimator(t)

	good := []Line{{500, "g", "flour"}}
	bad := []Line{{500, "g", "unicorn tears"}}

	combined, groups := e.EstimateGroups(context.Background(), []Group{
		{ID: "good", Lines: good},
		{ID: "bad", Lines: bad},
	})

	if got := groups[0].Coverage.ResolvedMassFraction; got < 0.99 {
		t.Errorf("good coverage = %v, want ~1", got)
	}
	if got := groups[1].Coverage.ResolvedMassFraction; got != 0 {
		t.Errorf("bad coverage = %v, want 0", got)
	}
	// Both lines have a known mass, so the unresolvable one sits in the
	// denominator at its true weight: half the plan's food is unaccounted for and
	// the combined figure has to say so.
	if got := combined.Coverage.ResolvedMassFraction; math.Abs(got-0.5) > 0.001 {
		t.Errorf("combined coverage = %v, want 0.5", got)
	}
	if got := combined.Coverage.ResolvedCount; got != 1 {
		t.Errorf("resolved count = %d, want 1", got)
	}
}

func TestEstimateGroupsEmpty(t *testing.T) {
	e := snapshotEstimator(t)
	combined, groups := e.EstimateGroups(context.Background(), nil)

	if len(groups) != 0 {
		t.Errorf("groups = %d, want 0", len(groups))
	}
	if combined.Coverage.TotalCount != 0 {
		t.Errorf("total count = %d, want 0", combined.Coverage.TotalCount)
	}
	if len(combined.Nutrients) != 0 {
		t.Errorf("nutrients = %v, want empty", combined.Nutrients)
	}
	if combined.EstimatedAt.IsZero() {
		t.Error("estimatedAt is zero; an empty rollup is still a dated answer")
	}
}

// A group with no lines is a recipe with no ingredients, not an error: it
// reports its own empty coverage and leaves the combined figure alone.
func TestEstimateGroupsEmptyGroupDoesNotDilute(t *testing.T) {
	e := snapshotEstimator(t)
	combined, groups := e.EstimateGroups(context.Background(), []Group{
		{ID: "real", Lines: []Line{{500, "g", "flour"}}},
		{ID: "hollow"},
	})

	if got := groups[1].Coverage.TotalCount; got != 0 {
		t.Errorf("hollow total count = %d, want 0", got)
	}
	if got := combined.Coverage.ResolvedMassFraction; got < 0.99 {
		t.Errorf("combined coverage = %v, want ~1", got)
	}
}

// Every line is resolved through the same path as the single-recipe estimate,
// so a provider that fails mid-rollup degrades to unresolved lines rather than
// sinking the whole plan.
func TestEstimateGroupsSurvivesAFailingProvider(t *testing.T) {
	e := NewEstimator(testNormalizer{}, &countingProvider{err: errors.New("fdc is down")}, testNutrients())

	combined, groups := e.EstimateGroups(context.Background(), []Group{
		{ID: "a", Lines: []Line{{100, "g", "flour"}}},
	})

	if got := combined.Coverage.ResolvedMassFraction; got != 0 {
		t.Errorf("coverage = %v, want 0", got)
	}
	if got := groups[0].Coverage.TotalCount; got != 1 {
		t.Errorf("group total count = %d, want 1", got)
	}
}
