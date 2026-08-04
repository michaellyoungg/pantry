package recommend

// pantryView is the user's pantry indexed for lookup, computed once per request
// rather than per candidate.
type pantryView struct {
	owned   map[string]bool // state "have" or "low"
	useItUp map[string]bool // owned AND flagged to use up
}

func newPantryView(items []PantryItem) pantryView {
	v := pantryView{owned: map[string]bool{}, useItUp: map[string]bool{}}
	for _, it := range items {
		// "out" means the user told us it is gone. Only "have"/"low" count.
		if it.State != "have" && it.State != "low" {
			continue
		}
		v.owned[it.CanonicalItem] = true
		if it.UseItUp {
			v.useItUp[it.CanonicalItem] = true
		}
	}
	return v
}

// match is what one candidate looks like against one pantry.
type match struct {
	have       []string
	missing    []MissingItem
	useItUpHit []string
	total      int
	// missingNonStaple counts the missing items that are NOT assumed on hand.
	// It is the whole difference between "you are out of chicken" and "you are
	// out of salt", and it is what the missingNonStaple feature scores.
	missingNonStaple int
}

// matchCandidate walks a candidate's ingredients once, de-duplicating by
// canonical item (a recipe can list "garlic" twice in different units).
func matchCandidate(c Candidate, v pantryView) match {
	var m match
	seen := map[string]bool{}
	for _, ing := range c.Ingredients {
		if seen[ing.CanonicalItem] {
			continue
		}
		seen[ing.CanonicalItem] = true
		m.total++
		switch {
		case v.useItUp[ing.CanonicalItem]:
			m.useItUpHit = append(m.useItUpHit, ing.CanonicalItem)
			m.have = append(m.have, ing.CanonicalItem)
		case v.owned[ing.CanonicalItem]:
			m.have = append(m.have, ing.CanonicalItem)
		default:
			m.missing = append(m.missing, MissingItem(ing))
			if !ing.Staple {
				m.missingNonStaple++
			}
		}
	}
	return m
}

// useItUpSaturation is how many flagged items a single recipe has to clear to
// earn a perfect use-it-up score. Without a cap, flagging 20 items would make
// every recipe score near zero on the feature that matters most.
const useItUpSaturation = 3

func pantryFeatures(m match, v pantryView, w Weights) []feature {
	flagged := len(v.useItUp)
	var useItUpValue float64
	if flagged > 0 {
		denom := min(flagged, useItUpSaturation)
		useItUpValue = float64(len(m.useItUpHit)) / float64(denom)
		if useItUpValue > 1 {
			useItUpValue = 1
		}
	}

	var coverage float64
	if m.total > 0 {
		coverage = float64(len(m.have)) / float64(m.total)
	}

	// missingNonStaple is a PENALTY, so its value is negative: the share of the
	// recipe's ingredients you would actually have to go and buy.
	//
	// Scoring the non-staple share rather than the raw missing count is what
	// makes the feature say something coverage does not. Coverage already knows
	// how much you have; this knows how much of the remainder is a real errand.
	// A recipe missing only salt scores 0 here — no penalty at all — while one
	// missing chicken and rice out of eight ingredients scores -0.25.
	var missingNonStaple float64
	if m.total > 0 {
		missingNonStaple = -float64(m.missingNonStaple) / float64(m.total)
	}

	return []feature{
		{
			name:      "useItUpHits",
			value:     useItUpValue,
			weight:    w.UseItUpHits,
			available: flagged > 0,
			// Unavailable when the user has flagged nothing — there is no signal
			// to read, so it must not count as a zero against every candidate.
		},
		{name: "coverage", value: coverage, weight: w.Coverage, available: m.total > 0},
		// Live since BL-0031 shipped the `staple` flag it was waiting on.
		{
			name:      "missingNonStaple",
			value:     missingNonStaple,
			weight:    w.MissingNonStaple,
			available: m.total > 0,
		},

		// --- wired, inert in increment 1 ---
		// Needs the interaction event log (increment 2).
		{name: "affinity", value: 0, weight: w.Affinity, available: false},
		// Needs plan HISTORY; the basket is current-week only, and current-week
		// recipes are hard-excluded via ExcludeRecipeIDs instead.
		{name: "recentlyPlanned", value: 0, weight: w.RecentlyPlanned, available: false},
	}
}
