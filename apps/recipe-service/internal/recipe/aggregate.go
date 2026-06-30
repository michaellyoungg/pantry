package recipe

import "strings"

// Aggregate combines ingredients across recipes into grocery lines.
// Matching is literal exact-match on item+unit (trimmed, lowercased).
// No unit conversion or synonym normalization yet (see backlog BL-0003).
func Aggregate(recipes []Recipe) []GroceryLine {
	type key struct{ item, unit string }
	sums := map[key]float64{}
	var order []key

	for _, rec := range recipes {
		for _, ing := range rec.Ingredients {
			k := key{
				item: strings.ToLower(strings.TrimSpace(ing.Item)),
				unit: strings.ToLower(strings.TrimSpace(ing.Unit)),
			}
			if _, seen := sums[k]; !seen {
				order = append(order, k)
			}
			sums[k] += ing.Quantity
		}
	}

	lines := make([]GroceryLine, 0, len(order))
	for _, k := range order {
		lines = append(lines, GroceryLine{Item: k.item, Unit: k.unit, Quantity: sums[k]})
	}
	return lines
}
