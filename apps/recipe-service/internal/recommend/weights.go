package recommend

// Weights are hand-tuned constants, not learned. They live in one struct so a
// tuning change is a single visible diff, and they are pinned by
// TestDefaultPantryWeightsArePinned so the change has to be deliberate.
type Weights struct {
	ExpiryUrgency    float64
	UseItUpHits      float64
	Coverage         float64
	MissingNonStaple float64
	Affinity         float64
	RecentlyPlanned  float64
	NutritionFit     float64
}

// DefaultPantryWeights favours clearing flagged use-it-up items over raw
// coverage: coverage alone would just rank whichever recipe has the fewest
// ingredients, and clearing what the user explicitly flagged is the point of
// the pantry intent.
//
// ExpiryUrgency sits narrowly ABOVE UseItUpHits (BL-0050), because the two
// signals fail differently. "You'd like this" is a prediction about taste and
// being wrong costs a scroll; "this spoils in two days" is a deadline in the
// physical world and being wrong costs food in the bin, with no way to recover
// tomorrow. Ranking by which error is recoverable puts the deadline first.
//
// The gap is small on purpose. Urgency and the use-it-up flag only ever disagree
// when the user flagged one thing while a DIFFERENT thing is quietly going off,
// and there the user's explicit instruction is meant to be narrowly outweighed
// by a fact they may not have noticed — not overruled.
//
// MissingNonStaple, Affinity and RecentlyPlanned have weights here but their
// features report UNAVAILABLE in increment 1 (no staple flag, no event log, no
// plan history), so they contribute to neither the numerator nor the
// denominator. See combine().
var DefaultPantryWeights = Weights{
	ExpiryUrgency:    3.5,
	UseItUpHits:      3.0,
	Coverage:         2.0,
	MissingNonStaple: 1.0,
	Affinity:         1.0,
	RecentlyPlanned:  1.0,
	// NutritionFit sits level with Coverage and below UseItUpHits on purpose.
	// This is the "cook what I have" intent: a goal the user set should reorder
	// the suggestions, not overrule what is about to go off in their fridge.
	// Hard constraints are unaffected by this number — they filter.
	NutritionFit: 2.0,
}
