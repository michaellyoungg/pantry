// Package nutrition estimates the nutrient content of a recipe from its
// ingredient lines.
//
// It deliberately does not import internal/recipe. Lines go in, an Estimate
// comes out, and the unit dictionary is reached through the small Normalizer
// interface below — which *recipe.Normalizer satisfies structurally. Keeping the
// dependency one-way is what makes the seam described in
// docs/superpowers/specs/2026-08-03-nutrition-system-design.md real: lifting
// this package into a standalone service later is a move, not a rewrite.
//
// Two shape decisions from that design are load-bearing and should not be
// "simplified" away:
//
//   - Nutrients are an open nutrientId -> amount map, never a typed macro
//     struct. Adding cholesterol or potassium is then a data change.
//   - Nutrient ids are FDC nutrient numbers ("1008" energy, "1003" protein),
//     not a parallel taxonomy of our own.
package nutrition

import "time"

// Line is one ingredient line to estimate: `{2, "clove", "garlic"}`.
type Line struct {
	Quantity float64
	Unit     string
	Item     string
}

// Normalizer is the slice of recipe.Normalizer this package needs: canonical
// ingredient keys, and unit dimensions for within-dimension conversion.
type Normalizer interface {
	CanonicalItem(raw string) (canonical, display, aisle string)
	Unit(raw string) (dimension string, toBase float64, ok bool)
}

// Dimensions reported by Normalizer.Unit.
const (
	dimMass   = "mass"
	dimVolume = "volume"
)

// Nutrient is reference data for one FDC nutrient number.
type Nutrient struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Unit string `json:"unit"`
}

// Food is one matched food: its per-100 g nutrient vector plus the gram weights
// of the household measures it publishes. Portions is what closes the gap the
// Normalizer cannot — volume and count to mass.
type Food struct {
	FDCID       int    `json:"fdcId"`
	Description string `json:"description"`
	// Nutrients maps FDC nutrient number -> amount per 100 g.
	Nutrients map[string]float64 `json:"nutrients"`
	// Portions maps a normalized portion key ("cup", "clove", "large") -> the
	// gram weight of ONE of that measure.
	Portions        map[string]float64 `json:"portions"`
	MatchConfidence float64            `json:"matchConfidence"`
	// Source is "snapshot" for the checked-in seed, "fdc" for a live lookup.
	Source string `json:"source"`
	// Reviewed pins a hand-corrected mapping: refreshes never overwrite it.
	Reviewed bool `json:"reviewed"`
}

// Provenance of a resolved gram weight.
const (
	MethodMass    = "mass"    // the unit is a mass unit; no food data needed
	MethodPortion = "portion" // the food publishes this exact household measure
	MethodDensity = "density" // a volume, converted through the food's density
	MethodCount   = "count"   // a per-piece gram weight
)

// Sources for a food record.
const (
	SourceSnapshot = "snapshot"
	SourceFDC      = "fdc"
)

// NutrientAmount is one nutrient on the wire.
type NutrientAmount struct {
	NutrientID string  `json:"nutrientId"`
	Amount     float64 `json:"amount"`
	Unit       string  `json:"unit"`
}

// Coverage is the honest account of how much of the recipe the estimate
// actually covers. It is not optional: an estimate that silently reports 40% of
// a recipe as though it were 100% is worse than one that admits it does not
// know, and with goal tracking downstream it would corrupt the headline feature.
type Coverage struct {
	ResolvedMassFraction float64 `json:"resolvedMassFraction"` // 0..1
	ResolvedCount        int     `json:"resolvedCount"`
	TotalCount           int     `json:"totalCount"`
}

// IngredientEstimate is per-line provenance: what we made of each line, and why
// we failed when we did.
type IngredientEstimate struct {
	Item string `json:"item"`
	// Grams is nil when the line's mass could not be determined.
	Grams *float64 `json:"grams"`
	// Resolved means the line contributed nutrients — mass known AND matched to
	// a food with a nutrient vector. A line can have a known mass and still be
	// unresolved (a weighed ingredient we have no nutrition data for).
	Resolved bool   `json:"resolved"`
	Reason   string `json:"reason,omitempty"`
	Method   string `json:"method,omitempty"`
	// MatchedFood is the FDC description we matched, so a wrong fuzzy match is
	// visible in the UI rather than buried in a table.
	MatchedFood string `json:"matchedFood,omitempty"`
}

// RecipeCoverage accounts for one recipe inside a multi-recipe rollup (BL-0037).
//
// A combined mass fraction cannot express every way a rollup can be incomplete.
// It describes the food it *saw*: a recipe that could not be loaded at all —
// deleted, or not visible to this caller — contributes nothing to either side of
// that ratio, so a day missing an entire dinner would otherwise report 100%
// coverage of the two recipes it did see. `Counted` is that missing case, named
// explicitly so a client can say "excluding 1 recipe" instead of quietly
// under-reporting.
type RecipeCoverage struct {
	RecipeID string `json:"recipeId"`
	Title    string `json:"title,omitempty"`
	// Multiplier is the servings dial this recipe contributed at.
	Multiplier float64 `json:"multiplier"`
	// Counted reports whether the recipe's ingredients reached the totals at all.
	Counted bool `json:"counted"`
	// Coverage is this recipe's own coverage, so a client can name the one dish
	// that dragged a day down rather than reporting a single blended percentage.
	Coverage Coverage `json:"coverage"`
}

// Estimate is the wire type, shared with packages/types.
type Estimate struct {
	Nutrients map[string]NutrientAmount `json:"nutrients"`
	// PerServing is omitted when the yield is unknown. Dividing by a guess would
	// produce a confidently wrong number, which is the one thing this design
	// refuses to do (BL-0035 supplies the real servings count).
	PerServing  map[string]NutrientAmount `json:"perServing,omitempty"`
	Servings    float64                   `json:"servings"`
	Coverage    Coverage                  `json:"coverage"`
	Ingredients []IngredientEstimate      `json:"ingredients"`
	EstimatedAt time.Time                 `json:"estimatedAt"`
	// Recipes is populated only by the multi-recipe rollup, where "which dish is
	// missing?" is a question a single blended coverage figure cannot answer.
	Recipes []RecipeCoverage `json:"recipes,omitempty"`
}
