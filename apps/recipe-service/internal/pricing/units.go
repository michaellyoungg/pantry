package pricing

import "strings"

// Dimension is the physical dimension a price is quoted in. A grocery line can
// only be priced against a bucket it can reach — see Estimator.estimateLine.
type Dimension string

const (
	DimensionMass   Dimension = "mass"   // base unit: gram
	DimensionVolume Dimension = "volume" // base unit: millilitre
	DimensionCount  Dimension = "count"  // base unit: one item
)

// unitFactors maps a recipe unit to its dimension and its factor to that
// dimension's base unit (gram / millilitre).
//
// This deliberately duplicates the `units` block of internal/recipe's
// normalization.json rather than importing it: internal/pricing must stay free
// of any dependency on internal/recipe so it can be promoted to its own service
// without untangling. TestUnitFactorsMatchNormalization asserts the two agree
// for every shared unit, so the duplication cannot drift silently.
var unitFactors = map[string]struct {
	dimension Dimension
	toBase    float64
}{
	"g":    {DimensionMass, 1},
	"kg":   {DimensionMass, 1000},
	"oz":   {DimensionMass, 28.3495},
	"lb":   {DimensionMass, 453.592},
	"ml":   {DimensionVolume, 1},
	"l":    {DimensionVolume, 1000},
	"tsp":  {DimensionVolume, 4.92892},
	"tbsp": {DimensionVolume, 14.7868},
	"cup":  {DimensionVolume, 236.588},
}

// lookupUnit resolves a recipe unit to its dimension and base-unit factor. ok is
// false for units with no physical dimension — "", "clove", "bunch", "can" — which
// are treated as counts.
func lookupUnit(raw string) (dimension Dimension, toBase float64, ok bool) {
	u, found := unitFactors[strings.ToLower(strings.TrimSpace(raw))]
	if !found {
		return "", 0, false
	}
	return u.dimension, u.toBase, true
}
