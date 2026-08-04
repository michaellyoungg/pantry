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

// Scale is the multiplier actually applied. Absent or nonsensical dials mean a
// single batch; nutrition and the grocery list read it through this one method
// so a plan can never be shopped for at one scale and counted at another.
func (e ScaledRecipe) Scale() float64 {
	if e.Multiplier <= 0 {
		return 1
	}
	return e.Multiplier
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
		// Per-recipe contributions to this line, in the same units as base, so a
		// client can show what a merged line is actually made of. srcOrder keeps
		// first-seen recipe order; srcBase/srcTitle are keyed by recipe id, which
		// makes a recipe planned twice in one week one source with a summed
		// amount rather than the same title twice.
		srcOrder []string
		srcBase  map[string]float64
		srcTitle map[string]string
	}
	accs := map[key]*acc{}
	var order []key

	for _, e := range entries {
		mult := e.Scale()
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
				a = &acc{
					display:  display,
					aisle:    aisle,
					srcBase:  map[string]float64{},
					srcTitle: map[string]string{},
				}
				if convertible {
					a.dim = dim
				} else {
					a.unit = strings.ToLower(strings.TrimSpace(ing.Unit))
				}
				accs[k] = a
				order = append(order, k)
			}
			contribution := ing.Quantity * mult
			if convertible {
				contribution *= toBase
			}
			a.base += contribution
			// A recipe with no id can't be linked to from the provenance sheet, so
			// it contributes nothing traceable. Every stored recipe has one; this
			// only skips synthetic recipes assembled in memory.
			if id := e.Recipe.ID; id != "" {
				if _, seen := a.srcBase[id]; !seen {
					a.srcOrder = append(a.srcOrder, id)
					a.srcTitle[id] = e.Recipe.Title
				}
				a.srcBase[id] += contribution
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

		// Contributions were summed in base units; re-express them in whatever
		// display unit the line ended up in so they add up to its quantity. An
		// unrecognised display unit (a dimension with no ladder) means base units
		// were already the display units, so the divisor stays 1.
		perDisplayUnit := 1.0
		if a.dim != "" {
			if _, toBase, ok := normalizer.Unit(unit); ok {
				perDisplayUnit = toBase
			}
		}
		var sources []GroceryLineSource
		for _, id := range a.srcOrder {
			sources = append(sources, GroceryLineSource{
				RecipeID: id,
				Title:    a.srcTitle[id],
				Quantity: snapNice(a.srcBase[id] / perDisplayUnit),
			})
		}

		lines = append(lines, GroceryLine{
			Item:          a.display,
			CanonicalItem: k.item,
			Unit:          unit,
			Quantity:      qty,
			Aisle:         a.aisle,
			Sources:       sources,
			// Computed here, on the summed line, and never per recipe: two recipes
			// each wanting 2 tbsp of parsley share one bunch, and pack arithmetic
			// done before aggregation would have bought two.
			Purchase: normalizer.purchaseFor(k.item, a.dim, a.base, qty, unit),
		})
	}

	// Stable sort keeps first-seen order within an aisle.
	sort.SliceStable(lines, func(i, j int) bool {
		return normalizer.aisleRank(lines[i].Aisle) < normalizer.aisleRank(lines[j].Aisle)
	})
	return lines
}
