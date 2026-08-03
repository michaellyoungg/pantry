package recommend

import "testing"

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

func TestRankPantryHonoursLimit(t *testing.T) {
	uc := UserContext{Pantry: have("rice"), Limit: 1}
	got := RankPantry(uc, []Candidate{cand("a", "A", "rice"), cand("b", "B", "rice")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
}
