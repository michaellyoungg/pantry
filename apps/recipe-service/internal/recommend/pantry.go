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
		// Nothing in common with the pantry means nothing to say about it.
		if len(m.have) == 0 {
			continue
		}
		results = append(results, Result{
			RecipeID: c.RecipeID,
			Title:    c.Title,
			Source:   c.Source,
			Score:    combine(pantryFeatures(m, view, w)),
			// Every slice here MUST be non-nil: encoding/json renders a nil
			// slice as `null`, and the web client's non-nullable TS types
			// (e.g. `r.missing.length`) then throw on a fully-covered recipe
			// — the primary success path, not an edge case.
			Reasons: nonNilStrings(pantryReasons(m)),
			Have:    nonNilStrings(m.have),
			Missing: nonNilMissing(m.missing),
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
