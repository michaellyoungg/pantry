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
}

// CandidateIngredient is one ingredient reduced to what scoring needs.
type CandidateIngredient struct {
	CanonicalItem string
	Display       string
}

// Candidate is a recipe reduced to identity plus canonicalized ingredients.
// The CALLER canonicalizes; recommend never sees raw ingredient text.
type Candidate struct {
	RecipeID    string
	Title       string
	Source      string // "catalog" | "user"
	Ingredients []CandidateIngredient
}

// MissingItem is an ingredient the recipe needs that the user does not have.
type MissingItem struct {
	CanonicalItem string `json:"canonicalItem"`
	Display       string `json:"display"`
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
}
