package recommend

import "testing"

// Set selection (BL-0033) needs the candidates the pantry surface throws away:
// a recipe that matches nothing in the fridge can still be the right Thursday
// because it shares a chicken with Tuesday.

func TestRankPantryDropsUnmatchedByDefault(t *testing.T) {
	uc := UserContext{Pantry: have("tomato")}
	got := RankPantry(uc, []Candidate{
		cand("match", "Match", "tomato", "basil"),
		cand("nomatch", "No match", "beef", "wine"),
	})
	eq(t, ids(got), []string{"match"})
}

func TestRankPantryKeepsUnmatchedWhenAsked(t *testing.T) {
	uc := UserContext{Pantry: have("tomato"), IncludeUnmatched: true}
	got := RankPantry(uc, []Candidate{
		cand("match", "Match", "tomato", "basil"),
		cand("nomatch", "No match", "beef", "wine"),
	})
	// Kept, but ranked BELOW the pantry match — including it must not flatten
	// the signal that made the other one better.
	eq(t, ids(got), []string{"match", "nomatch"})
}

// The empty-pantry case is the one that makes the flag necessary: a brand-new
// user pressing "Suggest my week" has nothing marked, and an empty proposal
// would read as "we have no recipes" rather than "we know nothing about you".
func TestRankPantryWithEmptyPantryReturnsCandidatesWhenAsked(t *testing.T) {
	uc := UserContext{IncludeUnmatched: true}
	got := RankPantry(uc, []Candidate{
		cand("a", "A", "beef", "wine"),
		cand("b", "B", "tofu", "soy sauce"),
	})
	if len(got) != 2 {
		t.Fatalf("got %d results, want 2", len(got))
	}
	// Documenting a real limitation of set selection rather than asserting a
	// desirable property: with nothing in the pantry, coverage is 0 and the
	// missingNonStaple penalty drives the weighted sum negative, which combine()
	// clamps to 0. Every candidate therefore ties, and the FIRST pick of a
	// suggested week is decided by the recipe-id tiebreak. The set-level terms
	// still shape picks 2..n, so the week is coherent; only its entry point is
	// arbitrary. See docs/superpowers/specs/2026-08-03-suggest-my-week-design.md.
	for _, r := range got {
		if r.Score != 0 {
			t.Fatalf("%s scored %v, want 0 — the empty-pantry tie is load-bearing "+
				"for BL-0033's documented limitation", r.RecipeID, r.Score)
		}
	}
}

// Hard filters still run first. IncludeUnmatched widens the pool; it must never
// widen it past an avoided ingredient.
func TestIncludeUnmatchedStillHonoursAvoidList(t *testing.T) {
	uc := UserContext{
		IncludeUnmatched: true,
		Preferences:      Preferences{AvoidItems: []string{"peanut"}},
	}
	got := RankPantry(uc, []Candidate{
		cand("safe", "Safe", "beef", "wine"),
		cand("unsafe", "Unsafe", "peanut", "noodle"),
	})
	eq(t, ids(got), []string{"safe"})
}
