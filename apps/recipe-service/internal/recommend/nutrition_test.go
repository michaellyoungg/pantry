package recommend

import (
	"encoding/json"
	"strings"
	"testing"
)

// Nutrient ids are FDC nutrient numbers, the same identifiers the estimate and
// the targets are keyed by (see internal/nutrition).
const (
	protein     = "1003"
	cholesterol = "1253"
)

func nutri(coverage float64, amounts map[string]float64) *CandidateNutrition {
	return &CandidateNutrition{
		PerServing: amounts,
		Coverage: NutritionCoverage{
			ResolvedMassFraction: coverage,
			ResolvedCount:        3,
			TotalCount:           3,
		},
	}
}

func withNutrition(c Candidate, n *CandidateNutrition) Candidate {
	c.Nutrition = n
	return c
}

func scoreOf(t *testing.T, rs []Result, id string) float64 {
	t.Helper()
	for _, r := range rs {
		if r.RecipeID == id {
			return r.Score
		}
	}
	t.Fatalf("no result for %q in %v", id, ids(rs))
	return 0
}

func target(nutrientID, op string, value float64, period string) NutritionTarget {
	return NutritionTarget{NutrientID: nutrientID, Operator: op, Value: value, Period: period}
}

func hard(t NutritionTarget) NutritionTarget {
	t.Hard = true
	return t
}

// The load-bearing rule of BL-0040: a candidate whose ingredients never resolved
// is a DATA gap, not a nutritional verdict. It must score exactly as it did
// before the user set any goal at all.
func TestUnmeasuredCandidateIsRankedNeutrally(t *testing.T) {
	uc := UserContext{Pantry: have("rice", "egg")}
	candidates := []Candidate{cand("r1", "Fried rice", "rice", "egg")}

	before := RankPantry(uc, candidates)

	uc.NutritionTargets = []NutritionTarget{target(protein, ">=", 40, "meal")}
	after := RankPantry(uc, candidates)

	closeTo(t, scoreOf(t, after, "r1"), scoreOf(t, before, "r1"))
	if after[0].NutritionFit != nil {
		t.Fatalf("unmeasured candidate reported a fit: %v", *after[0].NutritionFit)
	}
}

// Coverage below the threshold is the same kind of silence as no data at all:
// we saw some of the food, not enough of it to make a claim.
func TestLowCoverageCandidateIsRankedNeutrally(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{target(protein, ">=", 40, "meal")},
	}
	low := withNutrition(cand("r1", "Fried rice", "rice", "egg"),
		nutri(0.4, map[string]float64{protein: 2}))

	got := RankPantry(uc, []Candidate{low})

	if got[0].NutritionFit != nil {
		t.Fatalf("low-coverage candidate reported a fit: %v", *got[0].NutritionFit)
	}
	closeTo(t, got[0].Score, RankPantry(UserContext{Pantry: uc.Pantry}, []Candidate{low})[0].Score)
}

// Coverage measures resolved MASS, not nutrient completeness. A food matched
// without a cholesterol figure is not a food with no cholesterol.
func TestNutrientAbsentFromVectorIsNeutral(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{target(cholesterol, "<=", 200, "meal")},
	}
	c := withNutrition(cand("r1", "Fried rice", "rice", "egg"),
		nutri(1.0, map[string]float64{protein: 30}))

	got := RankPantry(uc, []Candidate{c})

	if got[0].NutritionFit != nil {
		t.Fatalf("a nutrient we never measured produced a fit: %v", *got[0].NutritionFit)
	}
}

// Soft goals REORDER. Both recipes use the same pantry items, so nutrition is
// the only thing that can separate them.
func TestSoftGoalReordersEquallyPantryFitCandidates(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{target(protein, ">=", 40, "meal")},
	}
	lean := withNutrition(cand("a-lean", "Lean bowl", "rice", "egg"),
		nutri(1.0, map[string]float64{protein: 5}))
	rich := withNutrition(cand("z-rich", "Protein bowl", "rice", "egg"),
		nutri(1.0, map[string]float64{protein: 40}))

	got := RankPantry(uc, []Candidate{lean, rich})

	// "z-rich" sorts after "a-lean" on the id tiebreak, so leading here can only
	// be the nutrition feature.
	eq(t, ids(got), []string{"z-rich", "a-lean"})
}

// Hard constraints FILTER. Same score dimension, different use.
func TestHardConstraintRemovesAMeasuredViolation(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{hard(target(cholesterol, "<=", 200, "meal"))},
	}
	over := withNutrition(cand("over", "Egg mountain", "rice", "egg"),
		nutri(1.0, map[string]float64{cholesterol: 400}))
	under := withNutrition(cand("under", "Rice bowl", "rice", "egg"),
		nutri(1.0, map[string]float64{cholesterol: 50}))

	got := RankPantry(uc, []Candidate{over, under})

	eq(t, ids(got), []string{"under"})
}

// The operator does not decide filtering — the user's flag does. The identical
// target without the flag only reorders.
func TestSoftCapReordersRatherThanRemoves(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{target(cholesterol, "<=", 200, "meal")},
	}
	over := withNutrition(cand("a-over", "Egg mountain", "rice", "egg"),
		nutri(1.0, map[string]float64{cholesterol: 400}))
	under := withNutrition(cand("z-under", "Rice bowl", "rice", "egg"),
		nutri(1.0, map[string]float64{cholesterol: 50}))

	got := RankPantry(uc, []Candidate{over, under})

	eq(t, ids(got), []string{"z-under", "a-over"})
}

// The other half of the coverage rule: an unmeasured candidate survives a hard
// constraint (it was not shown to break it) but must never be presented as
// though it had passed one.
func TestHardConstraintFlagsRatherThanBuriesUnmeasuredCandidates(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{hard(target(cholesterol, "<=", 200, "meal"))},
	}
	unknown := cand("unknown", "Mystery bowl", "rice", "egg")

	got := RankPantry(uc, []Candidate{unknown})

	if len(got) != 1 {
		t.Fatalf("unmeasured candidate was dropped by a constraint it was never checked against: %v", ids(got))
	}
	if len(got[0].NutritionUnverified) != 1 || got[0].NutritionUnverified[0].NutrientID != cholesterol {
		t.Fatalf("missing unverified constraint: %+v", got[0].NutritionUnverified)
	}
}

// A floor cannot be broken by adding food, so a hard `>=` can only ever rank.
func TestHardFloorNeverFilters(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{hard(target(protein, ">=", 40, "meal"))},
	}
	tiny := withNutrition(cand("tiny", "Rice bowl", "rice", "egg"),
		nutri(1.0, map[string]float64{protein: 1}))

	got := RankPantry(uc, []Candidate{tiny})

	eq(t, ids(got), []string{"tiny"})
	if len(got[0].NutritionUnverified) != 0 {
		t.Fatalf("a measured candidate was reported unverified: %+v", got[0].NutritionUnverified)
	}
}

// Set-level fit. A 30 g dish does not satisfy a 700 g WEEK target on its own —
// it is scored on how much of what the week still NEEDS it closes.
func TestWeekTargetScoresAgainstTheRemainingGap(t *testing.T) {
	base := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{target(protein, ">=", 700, "week")},
	}
	dish := withNutrition(cand("r1", "Chicken bowl", "rice", "egg"),
		nutri(1.0, map[string]float64{protein: 30}))

	emptyWeek := RankPantry(base, []Candidate{dish})

	nearlyThere := base
	nearlyThere.PlanNutrition = &PlanNutrition{
		Nutrients: map[string]float64{protein: 680},
		Coverage:  NutritionCoverage{ResolvedMassFraction: 1, ResolvedCount: 9, TotalCount: 9},
	}
	almostDone := RankPantry(nearlyThere, []Candidate{dish})

	// 30 of 700 remaining is a poor fit; 30 of the 20 still missing saturates.
	closeTo(t, *emptyWeek[0].NutritionFit, 30.0/700.0)
	closeTo(t, *almostDone[0].NutritionFit, 1.0)
	if almostDone[0].Score <= emptyWeek[0].Score {
		t.Fatalf("closing the remaining gap did not rank higher: %v vs %v",
			almostDone[0].Score, emptyWeek[0].Score)
	}
}

// A goal the plan already meets tells us nothing about any candidate, so it must
// drop out of the average rather than score every candidate at 1 (or at 0).
func TestAlreadyMetWeekFloorGivesNoSignal(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{target(protein, ">=", 100, "week")},
		PlanNutrition: &PlanNutrition{
			Nutrients: map[string]float64{protein: 150},
			Coverage:  NutritionCoverage{ResolvedMassFraction: 1, ResolvedCount: 9, TotalCount: 9},
		},
	}
	dish := withNutrition(cand("r1", "Chicken bowl", "rice", "egg"),
		nutri(1.0, map[string]float64{protein: 30}))

	got := RankPantry(uc, []Candidate{dish})

	if got[0].NutritionFit != nil {
		t.Fatalf("a satisfied goal produced a fit: %v", *got[0].NutritionFit)
	}
	closeTo(t, got[0].Score, RankPantry(UserContext{Pantry: uc.Pantry}, []Candidate{dish})[0].Score)
}

// A week-level hard cap needs a trustworthy running total. Without one the dish
// still ranks, but the constraint must not silently filter on a number we made
// up — nor claim it was checked.
func TestWeekHardCapWithUnknownCommitmentFlagsInsteadOfFiltering(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{hard(target(cholesterol, "<=", 1000, "week"))},
		PlanNutrition: &PlanNutrition{
			Nutrients: map[string]float64{cholesterol: 900},
			// Below the coverage threshold: this total is not a fact.
			Coverage: NutritionCoverage{ResolvedMassFraction: 0.3, ResolvedCount: 3, TotalCount: 9},
		},
	}
	dish := withNutrition(cand("r1", "Egg bowl", "rice", "egg"),
		nutri(1.0, map[string]float64{cholesterol: 400}))

	got := RankPantry(uc, []Candidate{dish})

	if len(got) != 1 {
		t.Fatalf("filtered on an untrustworthy running total: %v", ids(got))
	}
	if len(got[0].NutritionUnverified) != 1 {
		t.Fatalf("week cap was not reported as unchecked: %+v", got[0].NutritionUnverified)
	}
}

// Day and meal targets judge the dish alone: a candidate has no assigned
// weekday, so netting it off a whole week's running total would be wrong.
func TestDayTargetIgnoresTheWeeksCommitment(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{hard(target(cholesterol, "<=", 200, "day"))},
		PlanNutrition: &PlanNutrition{
			Nutrients: map[string]float64{cholesterol: 5000},
			Coverage:  NutritionCoverage{ResolvedMassFraction: 1, ResolvedCount: 9, TotalCount: 9},
		},
	}
	dish := withNutrition(cand("r1", "Rice bowl", "rice", "egg"),
		nutri(1.0, map[string]float64{cholesterol: 50}))

	got := RankPantry(uc, []Candidate{dish})

	eq(t, ids(got), []string{"r1"})
}

// Several targets average rather than multiply, so one unmeasurable nutrient
// cannot silence the ones we can measure.
func TestMultipleTargetsAverageOverTheMeasurableOnes(t *testing.T) {
	uc := UserContext{
		Pantry: have("rice", "egg"),
		NutritionTargets: []NutritionTarget{
			target(protein, ">=", 40, "meal"),
			target(cholesterol, "<=", 200, "meal"),
		},
	}
	// Half the protein goal (0.5), and no cholesterol figure at all (skipped).
	dish := withNutrition(cand("r1", "Rice bowl", "rice", "egg"),
		nutri(1.0, map[string]float64{protein: 20}))

	got := RankPantry(uc, []Candidate{dish})

	closeTo(t, *got[0].NutritionFit, 0.5)
}

// A hard constraint is a filter, so an "about" target overshooting its band
// removes the candidate; the band itself mirrors @pantry/core's EQUALITY_BAND.
func TestAboutTargetPeaksAtTheRemainingAmount(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{target("1008", "==", 600, "meal")},
	}
	spot := withNutrition(cand("a-spot", "Exactly right", "rice", "egg"),
		nutri(1.0, map[string]float64{"1008": 600}))
	double := withNutrition(cand("z-double", "Twice as much", "rice", "egg"),
		nutri(1.0, map[string]float64{"1008": 1200}))

	got := RankPantry(uc, []Candidate{spot, double})

	closeTo(t, *got[0].NutritionFit, 1.0)
	closeTo(t, scoreOf(t, got, "z-double"), scoreOf(t, got, "z-double"))
	eq(t, ids(got), []string{"a-spot", "z-double"})
}

// Shortlist is what lets the caller buy nutrition data for a bounded set. It
// must agree with the ranker about which candidates are worth paying for.
func TestShortlistReturnsTopPantryMatchesOnly(t *testing.T) {
	uc := UserContext{Pantry: []PantryItem{
		{CanonicalItem: "rice", State: "have", UseItUp: true},
		{CanonicalItem: "egg", State: "have"},
	}}
	candidates := []Candidate{
		cand("uses-flagged", "Fried rice", "rice", "egg"),
		cand("plain", "Omelette", "egg"),
		cand("unrelated", "Toast", "bread"),
	}

	got := Shortlist(uc, candidates, 2)

	if len(got) != 2 {
		t.Fatalf("got %d candidates, want 2", len(got))
	}
	if got[0].RecipeID != "uses-flagged" {
		t.Fatalf("shortlist did not lead with the best pantry match: %+v", got)
	}
	// The candidate with nothing in common with the pantry never surfaces.
	for _, c := range got {
		if c.RecipeID == "unrelated" {
			t.Fatalf("shortlisted a candidate the ranker would have dropped")
		}
	}
}

// Shortlist must not consult nutrition — that is the data it exists to avoid
// having to fetch.
func TestShortlistIgnoresNutritionTargets(t *testing.T) {
	uc := UserContext{
		Pantry:           have("rice", "egg"),
		NutritionTargets: []NutritionTarget{hard(target(cholesterol, "<=", 1, "meal"))},
	}
	candidates := []Candidate{cand("r1", "Fried rice", "rice", "egg")}

	if got := Shortlist(uc, candidates, 5); len(got) != 1 {
		t.Fatalf("a hard constraint pruned the shortlist before nutrition was fetched: %v", got)
	}
}

// The web client's types are non-nullable, and a nil Go slice encodes as `null`.
func TestUnverifiedConstraintsEncodeAsAnArray(t *testing.T) {
	uc := UserContext{Pantry: have("rice", "egg")}
	got := RankPantry(uc, []Candidate{cand("r1", "Fried rice", "rice", "egg")})

	blob, err := json.Marshal(got[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(blob), `"nutritionUnverified":[]`) {
		t.Fatalf("nutritionUnverified did not encode as an array: %s", blob)
	}
	if !strings.Contains(string(blob), `"nutritionFit":null`) {
		t.Fatalf("an unscored fit must encode as null, not 0: %s", blob)
	}
}
