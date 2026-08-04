// Package recommend scores recipes against a user's pantry and preferences.
//
// It is deliberately DEPENDENCY-FREE: it imports nothing from the rest of the
// service, holds no state, and touches no database. Everything it knows about
// the caller arrives in a UserContext, and candidate recipes arrive with their
// ingredients ALREADY canonicalized. That is what keeps the ranker stateless
// (see BL-0005) and what makes every function here a pure, table-testable unit.
package recommend

// PantryItem is one thing the user has, keyed on the normalized ingredient id.
type PantryItem struct {
	CanonicalItem string `json:"canonicalItem"`
	State         string `json:"state"` // "have" | "low" | "out"
	UseItUp       bool   `json:"useItUp"`
	// UseBy is the approximate spoil date in epoch milliseconds (BL-0029), and
	// is a POINTER because "no date" is a real and common state — the shelf-life
	// table does not know every ingredient. A zero int64 would read as 1970,
	// i.e. maximally overdue, so absence must not collapse into a value.
	UseBy *int64 `json:"useBy,omitempty"`
}

// Preferences is the ingredient-grounded preference signal. AvoidItems is a
// HARD FILTER, never a weight — see RankPantry.
type Preferences struct {
	AvoidItems    []string `json:"avoidItems"`
	LikedItems    []string `json:"likedItems"`
	DislikedItems []string `json:"dislikedItems"`
}

// UserContext is everything the ranker knows about the caller for one request.
type UserContext struct {
	Pantry           []PantryItem       `json:"pantry"`
	Preferences      Preferences        `json:"preferences"`
	Affinities       map[string]float64 `json:"affinities"`
	SavedRecipeIDs   []string           `json:"savedRecipeIds"`
	ExcludeRecipeIDs []string           `json:"excludeRecipeIds"`
	Limit            int                `json:"limit"`
	// Now is the caller's clock in epoch milliseconds. It arrives in the payload
	// rather than being read from the server clock so that scoring stays a pure
	// function of its input — the same request always produces the same order,
	// which is what makes the expiry feature table-testable.
	//
	// A missing Now makes expiry UNAVAILABLE rather than defaulting to the
	// server's clock: an absent signal must degrade to "no signal", never to a
	// guess.
	Now int64 `json:"now"`

	// NutritionTargets are the caller's ACTIVE nutrition goals (BL-0038/0040).
	// Paused rows are filtered out before they get here: a paused goal is not a
	// goal, and the ranker should not have to know that.
	NutritionTargets []NutritionTarget `json:"nutritionTargets,omitempty"`
	// PlanNutrition is what the week's plan already commits, so a `week` target
	// is scored on the gap that remains rather than on the whole goal.
	PlanNutrition *PlanNutrition `json:"planNutrition,omitempty"`
}

// CandidateIngredient is one ingredient reduced to what scoring needs.
type CandidateIngredient struct {
	CanonicalItem string
	Display       string
	// Staple marks a keep-on-hand ingredient — salt, oil, the spice rack. The
	// CALLER decides, from the normalization dictionary (BL-0031); recommend
	// only reads the flag, in keeping with this package owning no data.
	//
	// False for anything the dictionary does not recognize, which is the
	// conservative reading: an unknown ingredient is one we cannot promise the
	// user has, so it counts against the recipe.
	Staple bool
}

// Candidate is a recipe reduced to identity plus canonicalized ingredients.
// The CALLER canonicalizes; recommend never sees raw ingredient text.
type Candidate struct {
	RecipeID    string
	Title       string
	Source      string // "catalog" | "user"
	Ingredients []CandidateIngredient
	// Nutrition is this recipe's per-serving nutrient vector (BL-0040), or nil
	// when nobody has estimated it. Nil is UNMEASURED, never zero — see
	// nutrition.go for why that distinction is the whole feature.
	Nutrition *CandidateNutrition
}

// MissingItem is an ingredient the recipe needs that the user does not have.
type MissingItem struct {
	CanonicalItem string `json:"canonicalItem"`
	Display       string `json:"display"`
	// Staple lets a client say "you have everything but the salt" instead of
	// listing salt beside chicken as though they were the same problem. It
	// carries the same value as the CandidateIngredient it came from.
	Staple bool `json:"staple"`
}

// Urgency is the most-urgent expiring ingredient a recipe would clear.
//
// It is a STRUCTURED field rather than another entry in Reasons on purpose
// (BL-0050). "This spoils in two days" and "you'd like this" are different kinds
// of claim, and the merged use-it-up card has to render them differently. Folded
// into the reason strings, the UI could only tell them apart by prefix-matching
// English; typed, it just reads the field.
//
// UseBy is echoed as an epoch timestamp rather than a day count so the card can
// format it with the same helper as its expiring-items strip, and the two
// cannot drift into different vocabularies for the same date.
type Urgency struct {
	CanonicalItem string `json:"canonicalItem"`
	Display       string `json:"display"`
	UseBy         int64  `json:"useBy"`
}

// Result is one ranked recommendation, carrying the reasons that produced it so
// the UI can explain itself without knowing anything about scoring.
type Result struct {
	RecipeID string        `json:"recipeId"`
	Title    string        `json:"title"`
	Source   string        `json:"source"`
	Score    float64       `json:"score"`
	Reasons  []string      `json:"reasons"`
	Have     []string      `json:"have"`
	Missing  []MissingItem `json:"missing"`
	// Omitted when nothing this recipe uses is expiring, which is also how the
	// UI decides not to draw the urgency line at all.
	Urgency *Urgency `json:"urgency,omitempty"`

	// NutritionFit is 0..1 for how well this candidate closes the plan's
	// REMAINING gap, or nil when nothing could be measured. Nil rather than 0:
	// a data gap is not a bad score, and the two must never look alike.
	NutritionFit *float64 `json:"nutritionFit"`
	// NutritionUnverified names hard constraints this candidate was never
	// checked against. It is the reason an unmeasured recipe can survive a
	// filter without being presented as having passed it.
	NutritionUnverified []UnverifiedConstraint `json:"nutritionUnverified"`
}
