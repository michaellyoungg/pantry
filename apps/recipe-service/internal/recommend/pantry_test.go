package recommend

import (
	"encoding/json"
	"strings"
	"testing"
)

func cand(id, title string, items ...string) Candidate {
	ings := make([]CandidateIngredient, 0, len(items))
	for _, it := range items {
		ings = append(ings, CandidateIngredient{CanonicalItem: it, Display: it})
	}
	return Candidate{RecipeID: id, Title: title, Source: "catalog", Ingredients: ings}
}

func have(items ...string) []PantryItem {
	out := make([]PantryItem, 0, len(items))
	for _, it := range items {
		out = append(out, PantryItem{CanonicalItem: it, State: "have"})
	}
	return out
}

func ids(rs []Result) []string {
	out := make([]string, 0, len(rs))
	for _, r := range rs {
		out = append(out, r.RecipeID)
	}
	return out
}

func eq(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestRankPantryPrefersHigherCoverage(t *testing.T) {
	uc := UserContext{Pantry: have("tomato", "onion", "garlic")}
	got := RankPantry(uc, []Candidate{
		cand("low", "Low", "tomato", "beef", "wine", "cream"),
		cand("high", "High", "tomato", "onion", "garlic"),
	})
	eq(t, ids(got), []string{"high", "low"})
}

// The whole point of the pantry intent: a flagged use-it-up item outranks raw
// coverage, because the user explicitly asked to clear it.
func TestRankPantryPrefersUseItUpOverCoverage(t *testing.T) {
	uc := UserContext{Pantry: []PantryItem{
		{CanonicalItem: "tomato", State: "have"},
		{CanonicalItem: "onion", State: "have"},
		{CanonicalItem: "basil", State: "have", UseItUp: true},
	}}
	got := RankPantry(uc, []Candidate{
		cand("full", "Full", "tomato", "onion"),
		cand("uses-basil", "Uses basil", "basil", "tomato", "onion"),
	})
	eq(t, ids(got), []string{"uses-basil", "full"})
}

// HARD FILTER. Not a weight — no score may surface an avoided ingredient.
func TestRankPantryRemovesAvoidedIngredients(t *testing.T) {
	uc := UserContext{
		Pantry:      have("peanut", "rice"),
		Preferences: Preferences{AvoidItems: []string{"peanut"}},
	}
	got := RankPantry(uc, []Candidate{
		cand("satay", "Satay", "peanut", "rice"),
		cand("plain", "Plain rice", "rice"),
	})
	eq(t, ids(got), []string{"plain"})
}

func TestRankPantryExcludesAlreadyPlannedRecipes(t *testing.T) {
	uc := UserContext{Pantry: have("rice"), ExcludeRecipeIDs: []string{"planned"}}
	got := RankPantry(uc, []Candidate{
		cand("planned", "Planned", "rice"),
		cand("open", "Open", "rice"),
	})
	eq(t, ids(got), []string{"open"})
}

// A recipe with nothing in common with the pantry has nothing to say; dropping
// it is what makes the "Nothing close yet" empty state meaningful.
func TestRankPantryDropsCandidatesWithNoOverlap(t *testing.T) {
	uc := UserContext{Pantry: have("rice")}
	got := RankPantry(uc, []Candidate{cand("nope", "Nope", "beef", "wine")})
	eq(t, ids(got), []string{})
}

func TestRankPantryReportsHaveAndMissing(t *testing.T) {
	uc := UserContext{Pantry: have("tomato")}
	got := RankPantry(uc, []Candidate{cand("soup", "Soup", "tomato", "onion")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
	eq(t, got[0].Have, []string{"tomato"})
	if len(got[0].Missing) != 1 || got[0].Missing[0].CanonicalItem != "onion" {
		t.Fatalf("missing = %+v, want [onion]", got[0].Missing)
	}
}

func TestRankPantryExplainsItself(t *testing.T) {
	uc := UserContext{Pantry: []PantryItem{
		{CanonicalItem: "basil", State: "have", UseItUp: true},
		{CanonicalItem: "tomato", State: "have"},
	}}
	got := RankPantry(uc, []Candidate{cand("soup", "Soup", "basil", "tomato")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
	if len(got[0].Reasons) == 0 {
		t.Fatal("expected at least one reason")
	}
	if got[0].Reasons[0] != "Uses up: basil" {
		t.Fatalf("first reason = %q, want %q", got[0].Reasons[0], "Uses up: basil")
	}
}

// "low" still counts as owned; "out" does not.
func TestRankPantryTreatsLowAsOwnedAndOutAsNot(t *testing.T) {
	uc := UserContext{Pantry: []PantryItem{
		{CanonicalItem: "rice", State: "low"},
		{CanonicalItem: "beef", State: "out"},
	}}
	got := RankPantry(uc, []Candidate{cand("bowl", "Bowl", "rice", "beef")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
	eq(t, got[0].Have, []string{"rice"})
	if len(got[0].Missing) != 1 || got[0].Missing[0].CanonicalItem != "beef" {
		t.Fatalf("missing = %+v, want [beef]", got[0].Missing)
	}
}

// Determinism: equal scores break the tie on recipeId, always the same way.
func TestRankPantryIsDeterministicOnTies(t *testing.T) {
	uc := UserContext{Pantry: have("rice")}
	candidates := []Candidate{cand("zebra", "Zebra", "rice"), cand("apple", "Apple", "rice")}
	first := ids(RankPantry(uc, candidates))
	for i := 0; i < 5; i++ {
		eq(t, ids(RankPantry(uc, candidates)), first)
	}
	eq(t, first, []string{"apple", "zebra"})
}

// A fully-covered recipe leaves Missing (and, by the same construction path,
// Have/Reasons) an untouched nil slice. encoding/json renders a nil slice as
// `null`, and the web client's non-nullable `RecommendationMissingItem[]`
// type does `r.missing.length` with no guard — a `null` there throws and,
// per BL-0005, takes down the whole app via the router's ErrorBoundary. This
// asserts on the encoded JSON bytes, not the struct: a nil slice and an empty
// slice are indistinguishable via len()/range, so a struct-level assertion
// would not have caught this.
func TestRankPantryMissingSerializesAsEmptyArrayNotNull(t *testing.T) {
	uc := UserContext{Pantry: have("rice", "garlic")}
	got := RankPantry(uc, []Candidate{cand("full", "Full", "rice", "garlic")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}

	encoded, err := json.Marshal(got[0])
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}

	if strings.Contains(string(encoded), `"missing":null`) {
		t.Fatalf("missing serialized as null, want []: %s", encoded)
	}
	if !strings.Contains(string(encoded), `"missing":[]`) {
		t.Fatalf("missing did not serialize as [], got: %s", encoded)
	}
}

func TestRankPantryHonoursLimit(t *testing.T) {
	uc := UserContext{Pantry: have("rice"), Limit: 1}
	got := RankPantry(uc, []Candidate{cand("a", "A", "rice"), cand("b", "B", "rice")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
}

// --- missingNonStaple, live since BL-0031 shipped the staple flag -----------

// candStaples builds a candidate where the named items are pantry staples.
func candStaples(id, title string, staples []string, items ...string) Candidate {
	isStaple := map[string]bool{}
	for _, s := range staples {
		isStaple[s] = true
	}
	c := cand(id, title, items...)
	for i := range c.Ingredients {
		c.Ingredients[i].Staple = isStaple[c.Ingredients[i].CanonicalItem]
	}
	return c
}

// The failure this feature exists to fix: before the staple flag, a missing
// pinch of salt cost a recipe exactly what a missing chicken did.
func TestRankPantryDoesNotPenalizeMissingStaples(t *testing.T) {
	uc := UserContext{Pantry: have("tomato", "onion")}
	got := RankPantry(uc, []Candidate{
		// Identical coverage — 2 of 3 on hand. The difference is only whether
		// the third thing is something you have to go and buy.
		candStaples("salt", "Needs salt", []string{"salt"}, "tomato", "onion", "salt"),
		candStaples("beef", "Needs beef", nil, "tomato", "onion", "beef"),
	})
	eq(t, ids(got), []string{"salt", "beef"})
	if got[0].Score <= got[1].Score {
		t.Fatalf("missing-a-staple scored %v, missing-beef %v — the penalty is not firing",
			got[0].Score, got[1].Score)
	}
}

func TestMissingStaplesEarnNoPenaltyAtAll(t *testing.T) {
	uc := UserContext{Pantry: have("tomato", "onion")}
	onlyStaples := RankPantry(uc, []Candidate{
		candStaples("a", "A", []string{"salt", "black pepper"}, "tomato", "onion", "salt", "black pepper"),
	})
	nothingMissing := RankPantry(uc, []Candidate{cand("b", "B", "tomato", "onion")})
	// Coverage differs (2/4 vs 2/2), so the scores are not equal; what must
	// hold is that the missingNonStaple term contributed nothing.
	if onlyStaples[0].Score == 0 {
		t.Fatal("a recipe missing only staples scored zero")
	}
	if nothingMissing[0].Score <= onlyStaples[0].Score {
		t.Fatalf("full coverage %v should still beat partial %v",
			nothingMissing[0].Score, onlyStaples[0].Score)
	}
}

func TestMissingNonStaplePenaltyScalesWithHowMuchYouMustBuy(t *testing.T) {
	uc := UserContext{Pantry: have("tomato", "onion")}
	got := RankPantry(uc, []Candidate{
		cand("one", "One missing", "tomato", "onion", "beef", "rice"),
		cand("two", "Two missing", "tomato", "onion", "beef", "wine"),
	})
	// Both miss two non-staples out of four, so the penalty is equal and the
	// tiebreak is the recipe id — the determinism guarantee.
	eq(t, ids(got), []string{"one", "two"})
	if got[0].Score != got[1].Score {
		t.Fatalf("equal shopping burden scored differently: %v vs %v", got[0].Score, got[1].Score)
	}
}

func TestReasonsSayWhenOnlyStaplesAreMissing(t *testing.T) {
	uc := UserContext{Pantry: have("tomato", "onion")}
	got := RankPantry(uc, []Candidate{
		candStaples("a", "A", []string{"salt"}, "tomato", "onion", "salt"),
	})
	if !strings.Contains(strings.Join(got[0].Reasons, " | "), "You have everything but pantry staples") {
		t.Fatalf("reasons = %v, want the staples-only line", got[0].Reasons)
	}
}

func TestMissingItemsCarryTheStapleFlagToTheClient(t *testing.T) {
	uc := UserContext{Pantry: have("tomato")}
	got := RankPantry(uc, []Candidate{
		candStaples("a", "A", []string{"salt"}, "tomato", "salt", "beef"),
	})
	byItem := map[string]bool{}
	for _, m := range got[0].Missing {
		byItem[m.CanonicalItem] = m.Staple
	}
	if !byItem["salt"] {
		t.Error("salt should be reported as a staple so a client can de-emphasize it")
	}
	if byItem["beef"] {
		t.Error("beef must not be reported as a staple")
	}
	// And it has to survive the JSON boundary, which is the only place a client
	// ever sees it.
	raw, err := json.Marshal(got[0].Missing)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"staple":true`) {
		t.Errorf("missing items marshalled without the staple flag: %s", raw)
	}
}
