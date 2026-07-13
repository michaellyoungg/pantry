package recipe

import (
	"sort"
	"strings"
)

// ScaledRecipe pairs a recipe with a servings multiplier applied to every
// ingredient quantity before aggregation. Multiplier <= 0 is treated as 1.
type ScaledRecipe struct {
	Recipe     Recipe
	Multiplier float64
}

// Aggregate combines ingredients across recipes into grocery lines at
// multiplier 1. Items are canonicalized (synonyms -> canonical), compatible
// units are summed in a base unit and shown in a friendly unit, and each line
// is tagged with a grocery aisle. Lines are returned sorted by aisle order,
// then first-seen order. Non-convertible units (clove, "", ...) combine only
// on exact unit match.
func Aggregate(recipes []Recipe) []GroceryLine {
	entries := make([]ScaledRecipe, len(recipes))
	for i, rec := range recipes {
		entries[i] = ScaledRecipe{Recipe: rec, Multiplier: 1}
	}
	return AggregateScaled(entries)
}

// AggregateScaled is Aggregate, scaling each recipe's ingredient quantities by
// its multiplier before summing. Canonicalization, unit conversion, aisle
// tagging, and sort order are identical to Aggregate.
func AggregateScaled(entries []ScaledRecipe) []GroceryLine {
	type key struct{ item, bucket string }
	type acc struct {
		display string
		aisle   string
		unit    string  // non-convertible unit, or "" for convertible
		dim     string  // dimension for convertible, or "" otherwise
		base    float64 // convertible: sum in base units; else: raw sum
	}
	accs := map[key]*acc{}
	var order []key

	for _, e := range entries {
		mult := e.Multiplier
		if mult <= 0 {
			mult = 1
		}
		for _, ing := range e.Recipe.Ingredients {
			canonical, display, aisle := normalizer.CanonicalItem(ing.Item)
			dim, toBase, convertible := normalizer.Unit(ing.Unit)

			var k key
			if convertible {
				k = key{canonical, "d:" + dim}
			} else {
				k = key{canonical, "u:" + strings.ToLower(strings.TrimSpace(ing.Unit))}
			}

			a := accs[k]
			if a == nil {
				a = &acc{display: display, aisle: aisle}
				if convertible {
					a.dim = dim
				} else {
					a.unit = strings.ToLower(strings.TrimSpace(ing.Unit))
				}
				accs[k] = a
				order = append(order, k)
			}
			if convertible {
				a.base += ing.Quantity * mult * toBase
			} else {
				a.base += ing.Quantity * mult
			}
		}
	}

	lines := make([]GroceryLine, 0, len(order))
	for _, k := range order {
		a := accs[k]
		var qty float64
		var unit string
		if a.dim != "" {
			qty, unit = normalizer.Friendly(a.dim, a.base)
		} else {
			qty, unit = snapNice(a.base), a.unit
		}
		lines = append(lines, GroceryLine{Item: a.display, Unit: unit, Quantity: qty, Aisle: a.aisle})
	}

	// Stable sort keeps first-seen order within an aisle.
	sort.SliceStable(lines, func(i, j int) bool {
		return normalizer.aisleRank(lines[i].Aisle) < normalizer.aisleRank(lines[j].Aisle)
	})
	return lines
}
