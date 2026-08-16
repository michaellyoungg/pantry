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
	CuisineMatch     float64
	TimeFit          float64
	// Discovery-surface features (BL-0005 increment 2). They carry a weight of
	// zero in DefaultPantryWeights because that surface never scores them: "cook
	// what I have" is not the place to be told a recipe is new.
	Novelty       float64
	NearDuplicate float64
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
// Affinity is live as of increment 2 but deliberately stays at 1.0 here — the
// LOWEST live weight on this surface. Taste is a good reason to reorder what you
// could cook tonight and a bad reason to overrule what is about to spoil. The
// discover surface, where taste IS the question, weights it four times higher.
//
// RecentlyPlanned still has a weight and still reports UNAVAILABLE (no plan
// history), so it contributes to neither the numerator nor the denominator. See
// combine().
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
	// CuisineMatch and TimeFit (BL-0030) sit below Coverage on purpose. Both are
	// stated tastes rather than facts about the food in the user's kitchen: on
	// the "cook what I have" surface, liking Thai is a good reason to reorder
	// suggestions and a bad reason to outrank the spinach going off tomorrow.
	//
	// They are equal to each other because neither dominates the other as an
	// intent — "I feel like Thai" and "I have 20 minutes" are the same kind of
	// ask, and a recipe answering both should beat one answering either.
	CuisineMatch: 1.5,
	TimeFit:      1.5,
	// The discover surface's own features are not scored here at all.
	Novelty:       0,
	NearDuplicate: 0,
}

// DefaultDiscoverWeights ranks "what should I try" — a different question from
// "what can I cook", and therefore a different ordering of the same features.
//
// Affinity DOMINATES, at four times its pantry weight. On this surface taste is
// not a tiebreak between things you can cook tonight; it is the entire question
// being asked. Everything else adjusts a taste-led ordering.
//
// CuisineMatch sits just under it and above TimeFit because a stated cuisine is
// a statement about what you want to eat, while a time limit is a statement
// about tonight — and discovery is a question about the former.
//
// Coverage is deliberately the SMALLEST live weight, a third of its value on the
// pantry surface. Being cookable from what you have is a pleasant bonus for a
// recipe you want to try; if it grew, discovery would quietly become the pantry
// endpoint under another name, which is the failure this surface exists to
// avoid. ExpiryUrgency and UseItUpHits are not scored here at all, for the same
// reason: the fridge is the other surface's question.
//
// NearDuplicate outweighs Novelty because they answer different questions and
// only one of them is about the food. "You have not seen this" is a fact about
// the UI; "this is the fourth chicken-and-rice recipe we have offered you" is a
// fact about the suggestion, and it is the one that makes a discovery surface
// feel repetitive.
var DefaultDiscoverWeights = Weights{
	Affinity:      4.0,
	CuisineMatch:  3.0,
	NearDuplicate: 2.5,
	TimeFit:       2.5,
	Novelty:       2.0,
	// Level with the pantry surface: a goal the user set should matter the same
	// amount whichever screen they are on.
	NutritionFit: 2.0,
	Coverage:     0.7,
	// Not scored on this surface. Named explicitly rather than left to the zero
	// value so that "we chose not to score this here" is visible in review.
	ExpiryUrgency:    0,
	UseItUpHits:      0,
	MissingNonStaple: 0,
	RecentlyPlanned:  0,
}
