package recommend

const dayMS = 86_400_000

// expiryHorizonDays is how far ahead a use-by date still counts as urgent. It
// MIRRORS EXPIRY_HORIZON_DAYS in apps/web/src/lib/expiry.ts, which decides which
// items the card lists as "to use this week". The two must agree, or the card
// would name items the ranker scored as fine and vice versa.
const expiryHorizonDays = 7

// urgencyFor maps a use-by date onto [0, 1]: 1 for anything due today or already
// overdue, 0 at or beyond the horizon, linear in between.
//
// Overdue saturates at 1 rather than growing without bound — a week-old yogurt
// is not twice as urgent as a day-old one, it is simply the thing to deal with,
// and an unbounded value would let one forgotten row dominate every score.
func urgencyFor(useBy, now int64) float64 {
	days := float64(useBy-now) / float64(dayMS)
	if days <= 0 {
		return 1
	}
	if days >= expiryHorizonDays {
		return 0
	}
	return 1 - days/expiryHorizonDays
}

// pantryView is the user's pantry indexed for lookup, computed once per request
// rather than per candidate.
type pantryView struct {
	owned   map[string]bool // state "have" or "low"
	useItUp map[string]bool // owned AND flagged to use up
	// urgency holds only items with a KNOWN use-by; an item absent from this map
	// has an unknown shelf life, which is not the same as a long one.
	urgency map[string]float64
	useBy   map[string]int64
	// hasExpiry is request-level, not per-candidate. Deciding availability per
	// candidate would normalize two rows of the same response by different weight
	// denominators, making their scores incomparable — the exact failure
	// combine() exists to prevent.
	hasExpiry bool
}

func newPantryView(items []PantryItem, now int64) pantryView {
	v := pantryView{
		owned:   map[string]bool{},
		useItUp: map[string]bool{},
		urgency: map[string]float64{},
		useBy:   map[string]int64{},
	}
	for _, it := range items {
		// "out" means the user told us it is gone. Only "have"/"low" count.
		if it.State != "have" && it.State != "low" {
			continue
		}
		v.owned[it.CanonicalItem] = true
		if it.UseItUp {
			v.useItUp[it.CanonicalItem] = true
		}
		// No clock means no opinion about time: without a caller timestamp there
		// is no honest way to turn a date into urgency.
		if it.UseBy != nil && now > 0 {
			v.urgency[it.CanonicalItem] = urgencyFor(*it.UseBy, now)
			v.useBy[it.CanonicalItem] = *it.UseBy
			v.hasExpiry = true
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
	// urgency is the MAX over the ingredients this recipe uses, never the sum.
	// A sum would rank a recipe using four mildly-aging things above the one
	// recipe that saves the spinach dying tomorrow — inverting the signal exactly
	// when it matters most. The question is "how urgent is the most urgent thing
	// this clears", and max is that question.
	urgency float64
	// mostUrgent is the ingredient that produced `urgency`, carried so the card
	// can name it. nil when nothing this recipe uses has a known date.
	mostUrgent *Urgency
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
			// Spelled out field by field rather than converted between the two
			// structs: a missing-ingredient line is a shopping errand, and it
			// says only what the user has to buy. Allergen membership rides on
			// CandidateIngredient for the hard filter and has no business in
			// this list.
			m.missing = append(m.missing, MissingItem{
				CanonicalItem: ing.CanonicalItem,
				Display:       ing.Display,
				Staple:        ing.Staple,
			})
			if !ing.Staple {
				m.missingNonStaple++
			}
			// A missing ingredient cannot be going off in the user's fridge, so it
			// never contributes urgency.
			continue
		}
		// Strictly greater keeps the FIRST ingredient at a tied urgency, so the
		// named item follows the recipe's own ingredient order deterministically.
		if u, ok := v.urgency[ing.CanonicalItem]; ok && (m.mostUrgent == nil || u > m.urgency) {
			m.urgency = u
			m.mostUrgent = &Urgency{
				CanonicalItem: ing.CanonicalItem,
				Display:       ing.Display,
				UseBy:         v.useBy[ing.CanonicalItem],
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
		// Highest weight, and the reason the two pantry cards merged (BL-0050).
		// Unavailable — not zero — when no owned row has a use-by date, so a user
		// whose ingredients the shelf-life table doesn't recognize is ranked
		// exactly as they were before expiry existed.
		{
			name:      "expiryUrgency",
			value:     m.urgency,
			weight:    w.ExpiryUrgency,
			available: v.hasExpiry,
		},
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

		// --- still wired and inert ---
		// Needs plan HISTORY; the basket is current-week only, and current-week
		// recipes are hard-excluded via ExcludeRecipeIDs instead.
		{name: "recentlyPlanned", value: 0, weight: w.RecentlyPlanned, available: false},
	}
}
