package nutrition

import "strings"

// testNormalizer mirrors the unit table in internal/recipe/normalization.json.
//
// It is duplicated rather than imported because internal/recipe imports this
// package (for the endpoint), so an in-package test that imported recipe back
// would be a cycle. TestNormalizerUnitsNutritionReliesOn in internal/recipe
// pins the two tables together from the other side.
type testNormalizer struct{}

var testUnits = map[string]struct {
	dim    string
	toBase float64
}{
	"tsp":  {dimVolume, 4.92892},
	"tbsp": {dimVolume, 14.7868},
	"cup":  {dimVolume, 236.588},
	"ml":   {dimVolume, 1},
	"l":    {dimVolume, 1000},
	"g":    {dimMass, 1},
	"kg":   {dimMass, 1000},
	"oz":   {dimMass, 28.3495},
	"lb":   {dimMass, 453.592},
}

var testSynonyms = map[string]string{
	"garlic cloves": "garlic",
	"fresh garlic":  "garlic",
	"scallions":     "green onion",
}

func (testNormalizer) CanonicalItem(raw string) (string, string, string) {
	norm := strings.ToLower(strings.TrimSpace(raw))
	if syn, ok := testSynonyms[norm]; ok {
		norm = syn
	}
	return norm, strings.TrimSpace(raw), "other"
}

func (testNormalizer) Unit(raw string) (string, float64, bool) {
	u, ok := testUnits[strings.ToLower(strings.TrimSpace(raw))]
	if !ok {
		return "", 0, false
	}
	return u.dim, u.toBase, true
}

// Test foods. Portion sets are deliberately sparse so each conversion path is
// forced: flour publishes only a cup (so tbsp must go through density), egg
// publishes only "large" (so a bare count must fall back through the size
// words), and mystery publishes nothing at all.
var (
	testFlour = Food{
		Description: "Wheat flour, white, all-purpose",
		Nutrients:   map[string]float64{"1008": 364, "1003": 10.33},
		Portions:    map[string]float64{"cup": 125},
	}
	testGarlic = Food{
		Description: "Garlic, raw",
		Nutrients:   map[string]float64{"1008": 149, "1003": 6.36},
		Portions:    map[string]float64{"clove": 3, "cup": 136},
	}
	testEgg = Food{
		Description: "Egg, whole, raw, fresh",
		Nutrients:   map[string]float64{"1008": 143, "1253": 372},
		Portions:    map[string]float64{"large": 50},
	}
	testMilk = Food{
		Description: "Milk, whole",
		Nutrients:   map[string]float64{"1008": 61},
		Portions:    map[string]float64{"cup": 244},
	}
	testOil = Food{
		Description: "Oil, olive",
		Nutrients:   map[string]float64{"1008": 884},
		Portions:    map[string]float64{"cup": 216},
	}
	testSalt = Food{
		Description: "Salt, table",
		Nutrients:   map[string]float64{"1093": 38758},
		Portions:    map[string]float64{"tsp": 6},
	}
	testCheddar = Food{
		Description: "Cheese, cheddar",
		Nutrients:   map[string]float64{"1008": 403},
		Portions:    map[string]float64{"cup": 113, "slice": 28},
	}
	// A food we matched but hold no nutrient data for: its mass is knowable, its
	// nutrition is not, and the two must not be confused.
	testMystery = Food{Description: "Mystery powder"}
)

func testNutrients() map[string]Nutrient {
	return map[string]Nutrient{
		"1008": {ID: "1008", Name: "Energy", Unit: "kcal"},
		"1003": {ID: "1003", Name: "Protein", Unit: "g"},
		"1093": {ID: "1093", Name: "Sodium, Na", Unit: "mg"},
		"1253": {ID: "1253", Name: "Cholesterol", Unit: "mg"},
	}
}
