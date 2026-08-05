package recommend

import "testing"

// --- The cold-start rule ------------------------------------------------
//
// This is the single most important property in the file, and the repo has now
// hit it three times (BL-0040's nutrition coverage, BL-0030's cuisineMatch, and
// now this). A user with no history has told us NOTHING about their taste, and
// "nothing" must not be scored as "bad". If it were, every new user and every
// un-interacted recipe would be silently punished by a feature carrying the
// heaviest weight on the discovery surface.

func TestAffinityIsUnavailableForAColdStartUser(t *testing.T) {
	v := newAffinityView(UserContext{})
	if v.available {
		t.Fatal("a user with no events and no stated likes must make affinity UNAVAILABLE, not zero")
	}
	if got := v.score(cand("r", "R", "garlic")); got != 0 {
		t.Fatalf("score = %v, want 0 when unavailable", got)
	}
}

// The DISCRIMINATING test, and the reason the rule is written down everywhere.
//
// A recipe a cold-start user has every ingredient for is a perfect answer to
// "what can I cook", and it must still score a perfect 1. Were absence scored as
// a zero instead of being excluded, this exact recipe would fall to 0.5 —
// halfway down the list — for the sole reason that its cook has never used the
// product before. Nothing about the food changed; only our ignorance did.
func TestColdStartDoesNotPunishAPerfectPantryMatch(t *testing.T) {
	candidates := []Candidate{cand("perfect", "Perfect", "tomato", "onion")}

	cold := RankPantry(UserContext{Pantry: have("tomato", "onion")}, candidates)

	// The same user, same recipe, with affinity data that happens to say nothing
	// about THIS recipe. Here the feature is available and legitimately scores 0
	// — a real observation — so it joins the denominator and pulls the average
	// down. That is correct. The point is that the cold-start user must NOT be
	// treated this way, because we have not observed anything about them at all.
	known := RankPantry(UserContext{
		Pantry:     have("tomato", "onion"),
		Affinities: map[string]float64{"anchovy": 1},
	}, candidates)

	if !(cold[0].Score > known[0].Score) {
		t.Fatalf("cold-start score %v must exceed the scored-as-zero score %v; "+
			"equal means absence is being scored as a zero",
			cold[0].Score, known[0].Score)
	}
}

// The other half of the same proof: with data, the feature actually moves the
// score. Absence being free is only interesting if presence is not.
func TestAffinityDataChangesTheScore(t *testing.T) {
	candidates := []Candidate{cand("a", "A", "tomato", "onion")}
	base := UserContext{Pantry: have("tomato", "onion")}
	warm := base
	warm.Affinities = map[string]float64{"tomato": -1, "onion": -1}

	cold := RankPantry(base, candidates)
	warmed := RankPantry(warm, candidates)
	if cold[0].Score == warmed[0].Score {
		t.Fatalf("affinity data changed nothing (%v) — the feature is not wired", cold[0].Score)
	}
}

// An EMPTY affinity map is the same statement as no map at all: we folded the
// log and it yielded no opinions. Both are "no signal".
func TestAffinityUnavailableForEmptyMap(t *testing.T) {
	v := newAffinityView(UserContext{Affinities: map[string]float64{}})
	if v.available {
		t.Fatal("an empty affinity map must be unavailable")
	}
}

// --- What makes it available -------------------------------------------

func TestAffinityAvailableFromDerivedWeights(t *testing.T) {
	v := newAffinityView(UserContext{Affinities: map[string]float64{"garlic": 0.8}})
	if !v.available {
		t.Fatal("a derived weight must make the feature available")
	}
}

// A brand-new user who filled in the settings form has stated a taste, even with
// an empty event log. That is real signal and must count.
func TestAffinityAvailableFromExplicitPreferencesAlone(t *testing.T) {
	v := newAffinityView(UserContext{
		Preferences: Preferences{LikedItems: []string{"garlic"}},
	})
	if !v.available {
		t.Fatal("a stated like must make affinity available with no events at all")
	}
	if got := v.scores["garlic"]; got != explicitWeight {
		t.Fatalf("garlic = %v, want %v", got, explicitWeight)
	}
}

// They said so. We do not argue with them using a month of inferred behaviour.
func TestExplicitPreferenceOverridesDerivedWeight(t *testing.T) {
	v := newAffinityView(UserContext{
		Affinities:  map[string]float64{"cilantro": 0.9},
		Preferences: Preferences{DislikedItems: []string{"cilantro"}},
	})
	if got := v.scores["cilantro"]; got != -explicitWeight {
		t.Fatalf("cilantro = %v, want %v — a stated dislike must beat a derived like", got, -explicitWeight)
	}
}

// An item on both lists resolves to the cautious answer, mirroring how the avoid
// list resolves ties by removing rather than by keeping.
func TestLikedAndDislikedResolvesToDisliked(t *testing.T) {
	v := newAffinityView(UserContext{Preferences: Preferences{
		LikedItems:    []string{"garlic"},
		DislikedItems: []string{"garlic"},
	}})
	if got := v.scores["garlic"]; got != -explicitWeight {
		t.Fatalf("garlic = %v, want %v", got, -explicitWeight)
	}
}

// --- Scoring ------------------------------------------------------------

// A candidate containing nothing we have an opinion about scores 0. That is a
// real observation, not a missing one — and it must NOT flip the feature to
// unavailable, because availability is request-level: two rows of one response
// normalized by different weight denominators are not comparable.
func TestCandidateWithNoOpinionatedIngredientScoresZeroNotUnavailable(t *testing.T) {
	v := newAffinityView(UserContext{Affinities: map[string]float64{"garlic": 1}})
	if got := v.score(cand("r", "R", "flour", "water")); got != 0 {
		t.Fatalf("score = %v, want 0", got)
	}
	if !v.available {
		t.Fatal("availability is request-level and must not depend on the candidate")
	}
}

// Saturation: more of the recipe pointing the same way is a stronger signal than
// one line pointing very hard.
func TestAffinityScoreSaturatesOnAgreement(t *testing.T) {
	v := newAffinityView(UserContext{Affinities: map[string]float64{
		"garlic": 1, "ginger": 1, "chilli": 1,
	}})
	one := v.score(cand("one", "One", "garlic", "flour", "water"))
	three := v.score(cand("three", "Three", "garlic", "ginger", "chilli"))
	closeTo(t, one, 1.0/float64(affinitySaturation))
	closeTo(t, three, 1)
	if one >= three {
		t.Fatalf("one match (%v) should score below three matches (%v)", one, three)
	}
}

// A recipe listing garlic in two units is not twice as garlicky.
func TestAffinityDeduplicatesByCanonicalItem(t *testing.T) {
	v := newAffinityView(UserContext{Affinities: map[string]float64{"garlic": 1}})
	twice := Candidate{RecipeID: "r", Title: "R", Ingredients: []CandidateIngredient{
		{CanonicalItem: "garlic", Display: "garlic"},
		{CanonicalItem: "garlic", Display: "garlic cloves"},
	}}
	closeTo(t, v.score(twice), 1.0/float64(affinitySaturation))
}

func TestAffinityScoreGoesNegativeForDislikedIngredients(t *testing.T) {
	v := newAffinityView(UserContext{Affinities: map[string]float64{"cilantro": -1}})
	got := v.score(cand("r", "R", "cilantro", "lime"))
	if got >= 0 {
		t.Fatalf("score = %v, want negative", got)
	}
}

// Weights arrive over HTTP from a caller we do not control. A derived weight of
// 12 must not produce a feature value outside [-1, 1], which combine() assumes.
func TestAffinityClampsOutOfRangeWeights(t *testing.T) {
	v := newAffinityView(UserContext{Affinities: map[string]float64{
		"a": 12, "b": 12, "c": 12,
	}})
	closeTo(t, v.score(cand("r", "R", "a", "b", "c")), 1)
}

// --- Reasons ------------------------------------------------------------

// A negative affinity is already expressed as a lower rank. Saying "you don't
// like this" on screen adds nothing the user can act on.
func TestAffinityReasonNeverStatesTheNegative(t *testing.T) {
	if got := affinityReason(-1); got != "" {
		t.Fatalf("reason for a negative affinity = %q, want empty", got)
	}
	if got := affinityReason(0); got != "" {
		t.Fatalf("reason for a neutral affinity = %q, want empty", got)
	}
	if affinityReason(1) == "" {
		t.Fatal("a strong positive affinity should be explained")
	}
}

// The pantry surface's reasons put taste LAST — it is a prediction, and the
// claims above it are facts about the food.
func TestPantryReasonsPutAffinityLast(t *testing.T) {
	uc := UserContext{
		Pantry:     have("garlic", "tomato"),
		Affinities: map[string]float64{"garlic": 1, "tomato": 1},
	}
	got := RankPantry(uc, []Candidate{cand("r", "R", "garlic", "tomato")})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1", len(got))
	}
	reasons := got[0].Reasons
	if len(reasons) == 0 || reasons[len(reasons)-1] != affinityReason(1) {
		t.Fatalf("reasons = %v, want the affinity line last", reasons)
	}
}
