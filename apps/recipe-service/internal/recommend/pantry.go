package recommend

import "sort"

const (
	defaultLimit = 20
	maxLimit     = 50
)

// RankPantry scores candidates for the "cook what I have" intent.
//
// Order of operations matters: hard filters run BEFORE scoring, so no score can
// surface an avoided ingredient.
func RankPantry(uc UserContext, candidates []Candidate) []Result {
	return rankPantryWith(uc, candidates, DefaultPantryWeights)
}

func rankPantryWith(uc UserContext, candidates []Candidate, w Weights) []Result {
	avoid := toSet(uc.Preferences.AvoidItems)
	exclude := toSet(uc.ExcludeRecipeIDs)
	view := newPantryView(uc.Pantry)

	results := make([]Result, 0, len(candidates))
	for _, c := range candidates {
		if exclude[c.RecipeID] || containsAvoided(c, avoid) {
			continue
		}
		m := matchCandidate(c, view)
		// Nothing in common with the pantry means nothing to say about it — but
		// only for the pantry surface. See UserContext.IncludeUnmatched.
		if len(m.have) == 0 && !uc.IncludeUnmatched {
			continue
		}

		// Nutrition is a hard filter and a ranking signal from the SAME
		// assessment, which is the point of BL-0040: the two can never disagree
		// about a candidate because there is only one judgement.
		na := assess(uc.NutritionTargets, c.Nutrition, uc.PlanNutrition)
		if na.violates {
			continue
		}

		features := append(pantryFeatures(m, view, w), nutritionFeature(na, w))
		reasons := pantryReasons(m)
		if r := nutritionReason(na); r != "" {
			reasons = append(reasons, r)
		}

		results = append(results, Result{
			RecipeID: c.RecipeID,
			Title:    c.Title,
			Source:   c.Source,
			Score:    combine(features),
			// Every slice here MUST be non-nil: encoding/json renders a nil
			// slice as `null`, and the web client's non-nullable TS types
			// (e.g. `r.missing.length`) then throw on a fully-covered recipe
			// — the primary success path, not an edge case.
			Reasons:             nonNilStrings(reasons),
			Have:                nonNilStrings(m.have),
			Missing:             nonNilMissing(m.missing),
			NutritionFit:        fitOrNil(na),
			NutritionUnverified: nonNilUnverified(na.unverified),
		})
	}

	// Deterministic: score descending, then recipeId ascending. Without the
	// tiebreak, equal scores would surface in map/slice order and reshuffle.
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Score != results[j].Score {
			return results[i].Score > results[j].Score
		}
		return results[i].RecipeID < results[j].RecipeID
	})

	limit := uc.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	if len(results) > limit {
		results = results[:limit]
	}
	return results
}

// Shortlist ranks on the pantry signal ALONE and returns the top n candidates.
//
// It exists so a caller can pay for expensive per-candidate data — a nutrition
// estimate is a lookup per ingredient line — on a bounded set instead of the
// whole corpus. Nutrition is deliberately ignored here: consulting it would
// require the very data this call exists to avoid fetching.
//
// The trade-off is stated rather than hidden. Because a hard constraint can only
// REMOVE candidates, a very restrictive diet can return fewer than the caller's
// limit even when the corpus holds more recipes that would have qualified. n
// should therefore be comfortably larger than the limit.
func Shortlist(uc UserContext, candidates []Candidate, n int) []Candidate {
	if n <= 0 {
		return nil
	}
	base := uc
	base.NutritionTargets = nil
	base.PlanNutrition = nil
	base.Limit = n

	byID := make(map[string]Candidate, len(candidates))
	for _, c := range candidates {
		byID[c.RecipeID] = c
	}

	ranked := rankPantryWith(base, candidates, DefaultPantryWeights)
	out := make([]Candidate, 0, len(ranked))
	for _, r := range ranked {
		if c, ok := byID[r.RecipeID]; ok {
			out = append(out, c)
		}
	}
	return out
}

// fitOrNil keeps "we could not measure this" distinguishable from "it scored
// zero". A pointer is the only encoding that survives the JSON boundary.
func fitOrNil(a nutritionAssessment) *float64 {
	if a.scored == 0 {
		return nil
	}
	fit := a.fit
	return &fit
}

func containsAvoided(c Candidate, avoid map[string]bool) bool {
	if len(avoid) == 0 {
		return false
	}
	for _, ing := range c.Ingredients {
		if avoid[ing.CanonicalItem] {
			return true
		}
	}
	return false
}

// nonNilStrings guarantees a slice that marshals to `[]`, never `null`. A nil
// and an empty slice are indistinguishable in Go but not in the JSON they
// produce, and the web client depends on the array form.
func nonNilStrings(xs []string) []string {
	if xs == nil {
		return []string{}
	}
	return xs
}

// nonNilMissing is nonNilStrings for MissingItem — see its doc comment.
func nonNilMissing(xs []MissingItem) []MissingItem {
	if xs == nil {
		return []MissingItem{}
	}
	return xs
}

func toSet(xs []string) map[string]bool {
	if len(xs) == 0 {
		return nil
	}
	s := make(map[string]bool, len(xs))
	for _, x := range xs {
		s[x] = true
	}
	return s
}
