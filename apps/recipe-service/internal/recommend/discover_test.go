package recommend

import (
	"encoding/json"
	"strings"
	"testing"
)

// userCand is `cand` for a recipe the user owns. The discover surface branches
// on Source — owned recipes are what a suggestion can be a near-duplicate OF —
// so the tests need both kinds.
func userCand(id, title string, items ...string) Candidate {
	c := cand(id, title, items...)
	c.Source = SourceUser
	return c
}

// --- Hard filters: identical to the pantry surface, and deliberately so ----

// SAFETY, not ranking. A second recommendation surface that filters slightly
// differently from the first is exactly how an allergen reaches a screen.
func TestRankDiscoverRemovesAvoidedIngredients(t *testing.T) {
	uc := UserContext{Preferences: Preferences{AvoidItems: []string{"peanut"}}}
	got := RankDiscover(uc, []Candidate{
		cand("safe", "Safe", "tomato", "onion"),
		cand("nope", "Nope", "peanut", "tomato"),
	})
	eq(t, ids(got), []string{"safe"})
}

// BL-0052: an avoid entry naming a FAMILY removes every member, on this surface
// as on the other. Peanut butter's canonical item is not "peanut".
func TestRankDiscoverRemovesAllergenFamilyMembers(t *testing.T) {
	satay := Candidate{RecipeID: "satay", Title: "Satay", Source: SourceCatalog,
		Ingredients: []CandidateIngredient{
			{CanonicalItem: "peanut butter", Display: "Peanut butter", Allergens: []string{"peanut"}},
			{CanonicalItem: "chicken", Display: "Chicken"},
		}}
	uc := UserContext{Preferences: Preferences{AvoidItems: []string{"peanut"}}}
	got := RankDiscover(uc, []Candidate{satay, cand("safe", "Safe", "chicken", "rice")})
	eq(t, ids(got), []string{"safe"})
}

// An avoided ingredient must not survive on the strength of a huge affinity
// score. Hard filters run BEFORE scoring; there is no score that buys an
// exception.
func TestAvoidBeatsAStrongAffinity(t *testing.T) {
	uc := UserContext{
		Preferences: Preferences{AvoidItems: []string{"peanut"}},
		Affinities:  map[string]float64{"peanut": 1, "chicken": 1, "lime": 1},
	}
	got := RankDiscover(uc, []Candidate{cand("satay", "Satay", "peanut", "chicken", "lime")})
	eq(t, ids(got), []string{})
}

// A recipe already on this week's plan is not a discovery.
func TestRankDiscoverExcludesPlannedRecipes(t *testing.T) {
	uc := UserContext{ExcludeRecipeIDs: []string{"planned"}}
	got := RankDiscover(uc, []Candidate{
		cand("planned", "Planned", "tomato"),
		cand("fresh", "Fresh", "onion"),
	})
	eq(t, ids(got), []string{"fresh"})
}

// The catalog row a user already cloned into their own collection is a literal
// duplicate of something they own. The clone itself stays in the pool —
// rediscovering a recipe you saved and forgot is what this surface is for.
func TestRankDiscoverRemovesSavedCatalogOriginals(t *testing.T) {
	uc := UserContext{SavedRecipeIDs: []string{"cat-1"}}
	got := RankDiscover(uc, []Candidate{
		cand("cat-1", "Catalog original", "tomato"),
		userCand("mine", "My clone", "tomato"),
	})
	eq(t, ids(got), []string{"mine"})
}

// "Not interested" is an answer. Re-asking with a marginally worse rank is not
// respecting it — the candidate is removed until the event ages out of the
// caller's recency window.
func TestDismissedCandidatesAreRemovedNotDownWeighted(t *testing.T) {
	uc := UserContext{Interactions: map[string]RecipeInteraction{
		"nope": {Dismissed: 1},
	}}
	got := RankDiscover(uc, []Candidate{
		cand("nope", "Dismissed", "tomato"),
		cand("keep", "Keep", "onion"),
	})
	eq(t, ids(got), []string{"keep"})
}

// --- Cold start ---------------------------------------------------------

// The discovery surface weights affinity most heavily of all, which makes it the
// surface where scoring absence as zero would do the most damage: every
// candidate for every new user would be flattened together at the bottom.
func TestDiscoverColdStartLeavesAffinityUnavailable(t *testing.T) {
	candidates := []Candidate{cand("a", "A", "tomato"), cand("b", "B", "onion")}

	cold := RankDiscover(UserContext{Interactions: map[string]RecipeInteraction{}}, candidates)
	known := RankDiscover(UserContext{
		Interactions: map[string]RecipeInteraction{},
		// Affinity data that says nothing about either candidate: available, and
		// legitimately zero for both.
		Affinities: map[string]float64{"anchovy": 1},
	}, candidates)

	if !(cold[0].Score > known[0].Score) {
		t.Fatalf("cold-start score %v must exceed the scored-as-zero score %v", cold[0].Score, known[0].Score)
	}
}

// A user who owns no recipes has nothing for a candidate to duplicate. That is
// missing data, not a clean bill of health, so the feature is unavailable rather
// than a flattering zero on every row.
func TestNearDuplicateUnavailableWhenTheUserOwnsNothing(t *testing.T) {
	if newOwnedCorpus([]Candidate{cand("c", "C", "tomato")}).available() {
		t.Fatal("a pool with no user-owned recipes must make nearDuplicate unavailable")
	}
	if !newOwnedCorpus([]Candidate{userCand("m", "M", "tomato")}).available() {
		t.Fatal("one owned recipe is enough to make the comparison meaningful")
	}
}

// Novelty reads the interaction history. No history sent at all is a gap; an
// EMPTY history is the stronger statement that nothing has been interacted with,
// which makes every candidate genuinely and equally new.
func TestNoveltyDistinguishesAbsentHistoryFromEmptyHistory(t *testing.T) {
	var absent, empty UserContext
	empty.Interactions = map[string]RecipeInteraction{}

	if absent.Interactions != nil {
		t.Fatal("precondition: an unset field is nil")
	}
	c := []Candidate{cand("a", "A", "tomato")}
	// With novelty unavailable the denominator is smaller, so the same candidate
	// scores differently. Equality here would mean the distinction is not read.
	if RankDiscover(absent, c)[0].Score == RankDiscover(empty, c)[0].Score {
		t.Fatal("absent and empty interaction maps must not score identically")
	}
}

// --- Ranking ------------------------------------------------------------

// Taste is the question this surface asks, so it must be the loudest answer.
func TestDiscoverRanksByAffinity(t *testing.T) {
	uc := UserContext{
		Interactions: map[string]RecipeInteraction{},
		Affinities:   map[string]float64{"garlic": 1, "ginger": 1, "chilli": 1},
	}
	got := RankDiscover(uc, []Candidate{
		cand("bland", "Bland", "flour", "water", "salt"),
		cand("loved", "Loved", "garlic", "ginger", "chilli"),
	})
	eq(t, ids(got), []string{"loved", "bland"})
}

// Impressions are the whole reason `shown` events are recorded: without them a
// six-recipe catalog shows the same card forever.
func TestNoveltyDemotesRepeatedlyShownCandidates(t *testing.T) {
	uc := UserContext{Interactions: map[string]RecipeInteraction{
		"stale": {Shown: 6},
	}}
	got := RankDiscover(uc, []Candidate{
		cand("stale", "Stale", "tomato"),
		cand("fresh", "Fresh", "tomato"),
	})
	eq(t, ids(got), []string{"fresh", "stale"})
}

func TestNoveltyValueDecaysWithEveryKindOfInteraction(t *testing.T) {
	closeTo(t, noveltyValue(RecipeInteraction{}), 1)
	closeTo(t, noveltyValue(RecipeInteraction{Shown: 1}), 0.5)
	closeTo(t, noveltyValue(RecipeInteraction{Accepted: 1}), 0.5)
	closeTo(t, noveltyValue(RecipeInteraction{Cooked: 1}), 0.5)
	// A dismissal removes the candidate outright, so it has no novelty story.
	closeTo(t, noveltyValue(RecipeInteraction{Dismissed: 3}), 1)
}

// The BL-0033 lesson, transplanted: an UNGATED similarity penalty fires on every
// pair — two recipes sharing salt and onion are "similar" — and cancels out the
// signals beside it. Below the gate it must be exactly zero.
func TestNearDuplicateIsZeroBelowTheThreshold(t *testing.T) {
	closeTo(t, nearDuplicateValue(0), 0)
	closeTo(t, nearDuplicateValue(nearDuplicateThreshold-0.01), 0)
	closeTo(t, nearDuplicateValue(nearDuplicateThreshold), 0)
	closeTo(t, nearDuplicateValue(1), -1)
}

func TestDiscoverDemotesNearDuplicatesOfOwnedRecipes(t *testing.T) {
	uc := UserContext{Interactions: map[string]RecipeInteraction{}}
	got := RankDiscover(uc, []Candidate{
		// A near-copy of the owned recipe below: 4 of 5 items in common.
		cand("copy", "Another chicken and rice", "chicken", "rice", "onion", "garlic", "soy"),
		cand("different", "Something else", "cod", "leek", "cream", "dill", "potato"),
		userCand("mine", "My chicken and rice", "chicken", "rice", "onion", "garlic", "stock"),
	})
	// "mine" itself is not penalised for resembling itself.
	if got[0].RecipeID == "copy" {
		t.Fatalf("the near-duplicate ranked first: %v", ids(got))
	}
	var copyScore, diffScore float64
	for _, r := range got {
		switch r.RecipeID {
		case "copy":
			copyScore = r.Score
		case "different":
			diffScore = r.Score
		}
	}
	if !(diffScore > copyScore) {
		t.Fatalf("different (%v) should outrank the near-duplicate (%v)", diffScore, copyScore)
	}
}

// A recipe is not a near-duplicate of itself, however exactly it matches.
func TestOwnedRecipeIsNotItsOwnNearDuplicate(t *testing.T) {
	mine := userCand("mine", "Mine", "chicken", "rice", "onion")
	closeTo(t, newOwnedCorpus([]Candidate{mine}).similarity(mine), 0)
}

func TestJaccardIsZeroForEmptySets(t *testing.T) {
	closeTo(t, jaccard(map[string]bool{}, map[string]bool{"a": true}), 0)
	closeTo(t, jaccard(nil, nil), 0)
}

// Discovery must not turn into the pantry endpoint under another name. Pantry
// coverage is the smallest live weight here, so a loved recipe you would have to
// shop for still beats a bland one you could cook tonight.
func TestPantryCoverageDoesNotOverpowerTasteOnDiscover(t *testing.T) {
	uc := UserContext{
		Interactions: map[string]RecipeInteraction{},
		Pantry:       have("flour", "water", "salt"),
		Affinities:   map[string]float64{"garlic": 1, "ginger": 1, "chilli": 1},
	}
	got := RankDiscover(uc, []Candidate{
		cand("cookable", "Cookable now", "flour", "water", "salt"),
		cand("loved", "Loved", "garlic", "ginger", "chilli"),
	})
	eq(t, ids(got), []string{"loved", "cookable"})
}

// --- Contract -----------------------------------------------------------

// Deterministic: score descending, recipeId ascending. Without the tiebreak,
// equal scores reshuffle on every refresh.
func TestRankDiscoverIsDeterministic(t *testing.T) {
	uc := UserContext{Interactions: map[string]RecipeInteraction{}}
	got := RankDiscover(uc, []Candidate{
		cand("c", "C", "tomato"),
		cand("a", "A", "tomato"),
		cand("b", "B", "tomato"),
	})
	eq(t, ids(got), []string{"a", "b", "c"})
}

func TestRankDiscoverRespectsLimit(t *testing.T) {
	candidates := []Candidate{
		cand("a", "A", "tomato"), cand("b", "B", "onion"), cand("c", "C", "garlic"),
	}
	if got := RankDiscover(UserContext{Limit: 2}, candidates); len(got) != 2 {
		t.Fatalf("got %d results, want 2", len(got))
	}
	if got := RankDiscover(UserContext{Limit: 500}, candidates); len(got) != 3 {
		t.Fatalf("got %d results, want 3", len(got))
	}
}

// A nil Go slice marshals to `null`, and the web client's non-nullable types
// then throw on the success path. This has crashed the whole app once already.
func TestRankDiscoverNeverEmitsNullSlices(t *testing.T) {
	got := RankDiscover(UserContext{}, []Candidate{cand("a", "A", "tomato")})
	blob, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"reasons":null`, `"have":null`, `"missing":null`,
		`"nutritionUnverified":null`} {
		if strings.Contains(string(blob), field) {
			t.Fatalf("payload contains %s: %s", field, blob)
		}
	}
}

// An empty result set is an empty ARRAY, not null — the caller renders a list.
func TestRankDiscoverReturnsEmptySliceNotNil(t *testing.T) {
	got := RankDiscover(UserContext{}, nil)
	if got == nil {
		t.Fatal("got nil, want an empty slice")
	}
	blob, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if string(blob) != "[]" {
		t.Fatalf("marshalled to %s, want []", blob)
	}
}

// Weights are a product decision. Pinning them makes a tuning change an
// intentional diff in review rather than a silent reordering of the surface.
func TestDefaultDiscoverWeightsArePinned(t *testing.T) {
	want := Weights{
		// Taste is the question this surface asks.
		Affinity:     4.0,
		CuisineMatch: 3.0,
		// "This is your fourth chicken-and-rice" is a fact about the suggestion;
		// "you have not seen this" is a fact about the UI. The former wins.
		NearDuplicate: 2.5,
		TimeFit:       2.5,
		Novelty:       2.0,
		NutritionFit:  2.0,
		// The smallest live weight, and the guard against discovery quietly
		// becoming the pantry endpoint.
		Coverage: 0.7,
		// Not scored here at all: the fridge is the other surface's question.
		ExpiryUrgency:    0,
		UseItUpHits:      0,
		MissingNonStaple: 0,
		RecentlyPlanned:  0,
	}
	if DefaultDiscoverWeights != want {
		t.Fatalf("weights = %+v, want %+v", DefaultDiscoverWeights, want)
	}
}
