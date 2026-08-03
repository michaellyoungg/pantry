package recommend

// Weights are hand-tuned constants, not learned. They live in one struct so a
// tuning change is a single visible diff, and they are pinned by
// TestDefaultPantryWeightsArePinned so the change has to be deliberate.
type Weights struct {
	UseItUpHits      float64
	Coverage         float64
	MissingNonStaple float64
	Affinity         float64
	RecentlyPlanned  float64
}

// DefaultPantryWeights favours clearing flagged use-it-up items over raw
// coverage: coverage alone would just rank whichever recipe has the fewest
// ingredients, and clearing what the user explicitly flagged is the point of
// the pantry intent.
//
// MissingNonStaple, Affinity and RecentlyPlanned have weights here but their
// features report UNAVAILABLE in increment 1 (no staple flag, no event log, no
// plan history), so they contribute to neither the numerator nor the
// denominator. See combine().
var DefaultPantryWeights = Weights{
	UseItUpHits:      3.0,
	Coverage:         2.0,
	MissingNonStaple: 1.0,
	Affinity:         1.0,
	RecentlyPlanned:  1.0,
}
