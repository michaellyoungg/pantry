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

// --- expiry urgency (BL-0050) ---

// testNow is an arbitrary fixed clock. Tests must never read the real one: the
// whole reason UserContext carries Now is to keep scoring a pure function.
const testNow int64 = 1_700_000_000_000

func inDays(d float64) *int64 {
	t := testNow + int64(d*float64(dayMS))
	return &t
}

// expiring builds a pantry where the named item carries a use-by date and the
// rest do not, which is the realistic shape: the shelf-life table knows some
// ingredients and not others.
func expiring(item string, useBy *int64, others ...string) []PantryItem {
	out := []PantryItem{{CanonicalItem: item, State: "have", UseBy: useBy}}
	for _, o := range others {
		out = append(out, PantryItem{CanonicalItem: o, State: "have"})
	}
	return out
}

func TestUrgencyForCurve(t *testing.T) {
	cases := []struct {
		name string
		days float64
		want float64
	}{
		{"a week overdue saturates at 1", -7, 1},
		{"due today", 0, 1},
		{"mid-horizon", 3.5, 0.5},
		{"at the horizon", 7, 0},
		{"beyond the horizon", 90, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			closeTo(t, urgencyFor(*inDays(tc.days), testNow), tc.want)
		})
	}
}

// The headline BL-0050 behaviour: with two recipes of equal coverage, the one
// clearing the item that is about to spoil ranks first.
func TestRankPantryPrefersExpiringOverEqualCoverage(t *testing.T) {
	uc := UserContext{
		Now:    testNow,
		Pantry: expiring("spinach", inDays(1), "rice"),
	}
	got := RankPantry(uc, []Candidate{
		cand("rice", "Rice Bowl", "rice"),
		cand("spinach", "Spinach Saute", "spinach"),
	})
	eq(t, ids(got), []string{"spinach", "rice"})
}

// Urgency is the MAX over a recipe's ingredients, never the sum: the recipe
// saving the item that dies tomorrow must beat the one using three items that
// are merely middle-aged. A sum would invert this.
func TestRankPantryUrgencyIsMaxNotSum(t *testing.T) {
	uc := UserContext{Now: testNow, Pantry: []PantryItem{
		{CanonicalItem: "spinach", State: "have", UseBy: inDays(0.5)},
		{CanonicalItem: "carrot", State: "have", UseBy: inDays(5)},
		{CanonicalItem: "celery", State: "have", UseBy: inDays(5)},
		{CanonicalItem: "leek", State: "have", UseBy: inDays(5)},
	}}
	got := RankPantry(uc, []Candidate{
		cand("many", "Mirepoix", "carrot", "celery", "leek"),
		cand("urgent", "Spinach Saute", "spinach"),
	})
	eq(t, ids(got), []string{"urgent", "many"})
}

// Rule 2 of the BL-0050 design, pinned: a spoil date narrowly outranks the
// user's own use-it-up flag when the two point at DIFFERENT items.
func TestRankPantryExpiryOutranksUseItUpFlag(t *testing.T) {
	uc := UserContext{Now: testNow, Pantry: []PantryItem{
		{CanonicalItem: "spinach", State: "have", UseBy: inDays(0)},
		{CanonicalItem: "rice", State: "have", UseItUp: true},
	}}
	got := RankPantry(uc, []Candidate{
		cand("flagged", "Rice Bowl", "rice"),
		cand("expiring", "Spinach Saute", "spinach"),
	})
	eq(t, ids(got), []string{"expiring", "flagged"})
}

// Rule 1, and the correctness bug BL-0050 exists to close: the avoid list is a
// hard pre-filter, so it removes a recipe even when that recipe clears the most
// urgent thing in the fridge. No score may outrank an allergen.
func TestRankPantryAvoidListBeatsMaximumUrgency(t *testing.T) {
	uc := UserContext{
		Now:         testNow,
		Pantry:      expiring("peanut", inDays(-3), "rice"),
		Preferences: Preferences{AvoidItems: []string{"peanut"}},
	}
	got := RankPantry(uc, []Candidate{
		cand("peanut", "Peanut Noodles", "peanut"),
		cand("rice", "Rice Bowl", "rice"),
	})
	eq(t, ids(got), []string{"rice"})
}

// The graceful-degradation guarantee: when no row carries a date the feature is
// UNAVAILABLE, so it leaves both numerator and denominator alone and the order
// is identical to a request with no expiry data at all.
func TestRankPantryWithoutDatesRanksIdenticallyToNoExpiry(t *testing.T) {
	candidates := []Candidate{
		cand("low", "Low", "tomato", "beef", "wine"),
		cand("high", "High", "tomato", "onion"),
	}
	baseline := RankPantry(UserContext{Pantry: have("tomato", "onion")}, candidates)
	withClock := RankPantry(UserContext{Now: testNow, Pantry: have("tomato", "onion")}, candidates)

	eq(t, ids(withClock), ids(baseline))
	for i := range baseline {
		closeTo(t, withClock[i].Score, baseline[i].Score)
	}
}

// A date with no clock must degrade to "no signal", not to epoch zero — which
// would read as fifty years overdue and mark everything maximally urgent.
func TestRankPantryWithoutNowIgnoresDates(t *testing.T) {
	candidates := []Candidate{
		cand("rice", "Rice Bowl", "rice"),
		cand("spinach", "Spinach Saute", "spinach"),
	}
	got := RankPantry(UserContext{Pantry: expiring("spinach", inDays(-30), "rice")}, candidates)
	for _, r := range got {
		if r.Urgency != nil {
			t.Fatalf("%s reported urgency with no clock: %+v", r.RecipeID, r.Urgency)
		}
	}
	// Tie on every available feature, so the recipeId tiebreak decides.
	eq(t, ids(got), []string{"rice", "spinach"})
}

// Urgency rides as a STRUCTURED field, not as another reason string, so the
// card can render "use this soon" differently from "you'd like this".
func TestRankPantryReportsUrgencyAsAStructuredField(t *testing.T) {
	uc := UserContext{Now: testNow, Pantry: expiring("spinach", inDays(2))}
	got := RankPantry(uc, []Candidate{cand("spinach", "Spinach Saute", "spinach")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
	u := got[0].Urgency
	if u == nil {
		t.Fatal("expected urgency to be reported")
	}
	if u.CanonicalItem != "spinach" || u.UseBy != *inDays(2) {
		t.Errorf("urgency = %+v, want spinach at the seeded date", u)
	}
	for _, r := range got[0].Reasons {
		if strings.Contains(strings.ToLower(r), "spoil") || strings.Contains(r, "Use soon") {
			t.Errorf("urgency leaked into reasons as %q; it must stay typed", r)
		}
	}
}

// Nothing inside the horizon means nothing to say: a date three months out must
// not draw a "use soon" line on every row.
func TestRankPantryOmitsUrgencyBeyondHorizon(t *testing.T) {
	uc := UserContext{Now: testNow, Pantry: expiring("garlic", inDays(90))}
	got := RankPantry(uc, []Candidate{cand("garlic", "Garlic Rice", "garlic")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
	if got[0].Urgency != nil {
		t.Errorf("urgency = %+v, want nil for a date beyond the horizon", got[0].Urgency)
	}
}

// A missing ingredient cannot be going off in the user's fridge, so it must not
// lend its urgency to a recipe the user cannot currently cook.
func TestRankPantryIgnoresUrgencyOfMissingIngredients(t *testing.T) {
	uc := UserContext{Now: testNow, Pantry: []PantryItem{
		{CanonicalItem: "rice", State: "have"},
		// Marked out: the user says it is gone, so it is missing from the recipe's
		// point of view and cannot be spoiling in their fridge.
		{CanonicalItem: "spinach", State: "out", UseBy: inDays(0)},
		// An unrelated owned item WITH a date, so the expiry feature is genuinely
		// available for this request. Without it the assertion below would hold
		// merely because expiry was switched off, proving nothing.
		{CanonicalItem: "yogurt", State: "have", UseBy: inDays(3)},
	}}
	got := RankPantry(uc, []Candidate{cand("bowl", "Spinach Rice", "rice", "spinach")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
	if got[0].Urgency != nil {
		t.Errorf("urgency = %+v, want nil — the expiring item is not on hand", got[0].Urgency)
	}
}

// The wire contract the web card reads.
func TestResultOmitsUrgencyKeyWhenAbsent(t *testing.T) {
	buf, err := json.Marshal(Result{RecipeID: "r"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(buf), "urgency") {
		t.Errorf("absent urgency should be omitted, got %s", buf)
	}
}
