package recommend

import "testing"

// withDiscovery decorates a candidate with the facets BL-0030 added. A nil
// minutes is the common case for existing recipes and is the trap these tests
// exist to guard.
func withDiscovery(c Candidate, cuisine string, minutes *int) Candidate {
	c.Cuisine = cuisine
	c.TotalMinutes = minutes
	return c
}

func mins(n int) *int { return &n }

// --- cuisineMatch -------------------------------------------------------

func TestCuisineMatchRanksAPreferredCuisineFirst(t *testing.T) {
	uc := UserContext{
		Pantry:      have("tomato"),
		Preferences: Preferences{Cuisines: []string{"thai"}},
	}
	got := RankPantry(uc, []Candidate{
		withDiscovery(cand("italian", "Italian", "tomato"), "italian", nil),
		withDiscovery(cand("thai", "Thai", "tomato"), "thai", nil),
	})
	eq(t, ids(got), []string{"thai", "italian"})
}

// The BL-0040 precedent, and the reason this feature is safe to turn on while
// most recipes are untagged: a recipe with no cuisine is UNMEASURED, not bad.
// It must score exactly as it would if the user had expressed no taste at all.
func TestCuisineMatchIsUnavailableWhenTheRecipeHasNoCuisine(t *testing.T) {
	untagged := withDiscovery(cand("r", "Untagged", "tomato"), "", nil)

	withPreference := RankPantry(UserContext{
		Pantry:      have("tomato"),
		Preferences: Preferences{Cuisines: []string{"thai"}},
	}, []Candidate{untagged})
	withoutPreference := RankPantry(UserContext{Pantry: have("tomato")}, []Candidate{untagged})

	closeTo(t, withPreference[0].Score, withoutPreference[0].Score)
}

// A cuisine we DID measure and the user did not ask for is a real observation,
// so it scores zero rather than dropping out — otherwise every tagged recipe
// would be indistinguishable from an untagged one.
func TestCuisineMatchScoresAKnownNonMatchBelowAnUntaggedRecipe(t *testing.T) {
	uc := UserContext{
		Pantry:      have("tomato"),
		Preferences: Preferences{Cuisines: []string{"thai"}},
	}
	got := RankPantry(uc, []Candidate{
		withDiscovery(cand("known-miss", "Italian", "tomato"), "italian", nil),
		withDiscovery(cand("untagged", "Untagged", "tomato"), "", nil),
	})
	eq(t, ids(got), []string{"untagged", "known-miss"})
}

func TestCuisineMatchIsUnavailableWhenTheUserNamedNoCuisine(t *testing.T) {
	thai := withDiscovery(cand("r", "Thai", "tomato"), "thai", nil)
	scored := RankPantry(UserContext{Pantry: have("tomato")}, []Candidate{thai})
	bare := RankPantry(UserContext{Pantry: have("tomato")}, []Candidate{cand("r", "Thai", "tomato")})
	closeTo(t, scored[0].Score, bare[0].Score)
}

// Preferences arrive as slugs from the same open vocabulary the recipe uses
// (BL-0020), but a client that sends "Thai" must not silently match nothing.
func TestCuisineMatchComparesCaseInsensitively(t *testing.T) {
	uc := UserContext{
		Pantry:      have("tomato"),
		Preferences: Preferences{Cuisines: []string{"Thai"}},
	}
	got := RankPantry(uc, []Candidate{
		withDiscovery(cand("italian", "Italian", "tomato"), "italian", nil),
		withDiscovery(cand("thai", "Thai", "tomato"), "thai", nil),
	})
	eq(t, ids(got), []string{"thai", "italian"})
}

func TestCuisineMatchNamesTheCuisineInItsReason(t *testing.T) {
	uc := UserContext{
		Pantry:      have("tomato"),
		Preferences: Preferences{Cuisines: []string{"south-indian"}},
	}
	got := RankPantry(uc, []Candidate{
		withDiscovery(cand("r", "Dosa", "tomato"), "south-indian", nil),
	})
	var found bool
	for _, r := range got[0].Reasons {
		if r == "South Indian, one of your favourites" {
			found = true
		}
	}
	if !found {
		t.Fatalf("no cuisine reason in %v", got[0].Reasons)
	}
}

// --- timeFit ------------------------------------------------------------

// THE trap BL-0020 flagged: an unknown cook time is not a fast recipe. It must
// score exactly as it would with no time preference set, never as a fit.
func TestUnknownCookTimeIsUnavailableRatherThanFast(t *testing.T) {
	unknown := withDiscovery(cand("r", "Unknown", "tomato"), "", nil)

	withLimit := RankPantry(UserContext{
		Pantry:      have("tomato"),
		Preferences: Preferences{MaxMinutes: mins(30)},
	}, []Candidate{unknown})
	withoutLimit := RankPantry(UserContext{Pantry: have("tomato")}, []Candidate{unknown})

	closeTo(t, withLimit[0].Score, withoutLimit[0].Score)
}

// The same trap stated as a ranking: a recipe that is genuinely quick must beat
// one whose time nobody recorded.
func TestKnownFastRecipeOutranksAnUnknownCookTime(t *testing.T) {
	uc := UserContext{
		Pantry:      have("tomato"),
		Preferences: Preferences{MaxMinutes: mins(30)},
	}
	got := RankPantry(uc, []Candidate{
		withDiscovery(cand("unknown", "Unknown", "tomato"), "", nil),
		withDiscovery(cand("fast", "Fast", "tomato"), "", mins(15)),
	})
	eq(t, ids(got), []string{"fast", "unknown"})
}

func TestTimeFitTreatsAnythingInsideTheLimitAsAFullFit(t *testing.T) {
	closeTo(t, timeFitValue(10, 30), 1)
	closeTo(t, timeFitValue(30, 30), 1)
}

// Beyond the limit the fit decays rather than falling off a cliff: a 35-minute
// recipe is not as wrong as a three-hour braise when you have half an hour.
func TestTimeFitDecaysBeyondTheLimitAndBottomsOutAtDouble(t *testing.T) {
	closeTo(t, timeFitValue(45, 30), 0.5)
	closeTo(t, timeFitValue(60, 30), 0)
	closeTo(t, timeFitValue(240, 30), 0)
}

func TestTimeFitIsUnavailableWhenTheUserSetNoLimit(t *testing.T) {
	fast := withDiscovery(cand("r", "Fast", "tomato"), "", mins(10))
	scored := RankPantry(UserContext{Pantry: have("tomato")}, []Candidate{fast})
	bare := RankPantry(UserContext{Pantry: have("tomato")}, []Candidate{cand("r", "Fast", "tomato")})
	closeTo(t, scored[0].Score, bare[0].Score)
}

// A non-positive limit is not a limit. It arrives from a cleared form field and
// must degrade to "no preference", never to "nothing qualifies".
func TestTimeFitIgnoresANonPositiveLimit(t *testing.T) {
	fast := withDiscovery(cand("r", "Fast", "tomato"), "", mins(10))
	scored := RankPantry(UserContext{
		Pantry:      have("tomato"),
		Preferences: Preferences{MaxMinutes: mins(0)},
	}, []Candidate{fast})
	bare := RankPantry(UserContext{Pantry: have("tomato")}, []Candidate{fast})
	closeTo(t, scored[0].Score, bare[0].Score)
}

func TestTimeFitClaimsAReasonOnlyWhenItFits(t *testing.T) {
	uc := UserContext{
		Pantry:      have("tomato"),
		Preferences: Preferences{MaxMinutes: mins(30)},
	}
	got := RankPantry(uc, []Candidate{
		withDiscovery(cand("fits", "Fits", "tomato"), "", mins(20)),
		withDiscovery(cand("over", "Over", "tomato"), "", mins(90)),
	})
	byID := map[string][]string{}
	for _, r := range got {
		byID[r.RecipeID] = r.Reasons
	}
	if !hasReason(byID["fits"], "Ready in 20 min") {
		t.Fatalf("expected a time reason on the fitting recipe, got %v", byID["fits"])
	}
	if hasReason(byID["over"], "Ready in 90 min") {
		t.Fatalf("a recipe over the limit must not claim it fits: %v", byID["over"])
	}
}

func hasReason(reasons []string, want string) bool {
	for _, r := range reasons {
		if r == want {
			return true
		}
	}
	return false
}
