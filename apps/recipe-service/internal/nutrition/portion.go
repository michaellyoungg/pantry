package nutrition

import (
	"regexp"
	"strings"
)

// leadingCount strips the count off a measure description: FDC writes portions
// as "1 medium", "1/2 cup", "1-1/2 tbsp". The gram weight is carried separately,
// so the count in the text is noise for keying purposes.
var leadingCount = regexp.MustCompile(`^\d[\d./\-]*(?:\s+|$)`)

// portionSynonyms folds the many spellings of a household measure onto the
// compact key food_portions is keyed by. It is an explicit table rather than a
// stemmer because the failure mode of guessing here is silent and numeric: map
// "fl oz" onto "oz" and a cup of milk becomes a quarter pound of it.
var portionSynonyms = map[string]string{
	// Volume.
	"tablespoon": "tbsp", "tablespoons": "tbsp", "tablespoonful": "tbsp",
	"tbsp": "tbsp", "tbsps": "tbsp", "tbs": "tbsp", "tbl": "tbsp", "tb": "tbsp",
	"teaspoon": "tsp", "teaspoons": "tsp", "teaspoonful": "tsp",
	"tsp": "tsp", "tsps": "tsp", "t": "tsp",
	"cup": "cup", "cups": "cup",
	"fluid ounce": "fl oz", "fluid ounces": "fl oz", "fl oz": "fl oz",
	"fl. oz": "fl oz", "fl.oz": "fl oz", "floz": "fl oz", "fl ounce": "fl oz",
	"milliliter": "ml", "milliliters": "ml", "millilitre": "ml", "millilitres": "ml",
	"ml": "ml", "cc": "ml",
	"liter": "l", "liters": "l", "litre": "l", "litres": "l", "l": "l",
	"pint": "pint", "pints": "pint", "pt": "pint",
	"quart": "quart", "quarts": "quart", "qt": "quart",
	"gallon": "gallon", "gallons": "gallon", "gal": "gallon",

	// Mass. Kept here so a portion row spelled "grams" keys the same as "g".
	"gram": "g", "grams": "g", "gramme": "g", "grammes": "g", "g": "g",
	"kilogram": "kg", "kilograms": "kg", "kg": "kg",
	"ounce": "oz", "ounces": "oz", "oz": "oz",
	"pound": "lb", "pounds": "lb", "lb": "lb", "lbs": "lb",

	// Countable measures.
	"clove": "clove", "cloves": "clove",
	"slice": "slice", "slices": "slice",
	"piece": "piece", "pieces": "piece",
	"head": "head", "heads": "head",
	"bunch": "bunch", "bunches": "bunch",
	"stalk": "stalk", "stalks": "stalk",
	"sprig": "sprig", "sprigs": "sprig",
	"leaf": "leaf", "leaves": "leaf",
	"stick": "stick", "sticks": "stick",
	"can": "can", "cans": "can",
	"package": "package", "packages": "package", "pkg": "package",
	"fillet": "fillet", "fillets": "fillet",
	"breast": "breast", "breasts": "breast",
	"serving": "serving", "servings": "serving",
	"each": "each", "ea": "each", "unit": "each", "whole": "each", "item": "each",

	// Size words, which FDC uses as the measure for whole produce and eggs.
	"small": "small", "sm": "small",
	"medium": "medium", "med": "medium", "medium size": "medium",
	"large": "large", "lg": "large",
	"extra large": "extra large", "xl": "extra large", "jumbo": "extra large",

	// FDC's placeholder when a portion has no household measure at all.
	"undetermined": "",
}

// portionKey normalizes a measure description — from an ingredient line's unit
// or an FDC portion row — to the compact key food_portions is keyed by.
// It returns "" for anything with no usable measure.
func portionKey(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	// FDC parenthesises dimensions: `medium (2-1/2" dia)`.
	if i := strings.IndexByte(s, '('); i >= 0 {
		s = s[:i]
	}
	// ...and qualifies the measure after a comma: `cup, chopped`.
	if i := strings.IndexByte(s, ','); i >= 0 {
		s = s[:i]
	}
	s = strings.TrimSpace(s)
	s = strings.Trim(s, `.;:-"' `)
	s = strings.TrimSpace(leadingCount.ReplaceAllString(s, ""))
	if s == "" {
		return ""
	}
	if k, ok := portionSynonyms[s]; ok {
		return k
	}
	// A measure we did not enumerate still keys consistently if we strip a plain
	// plural — "wedges" and "wedge" must not become two different portions.
	if bare := strings.TrimSuffix(s, "s"); bare != s && len(bare) > 2 {
		if k, ok := portionSynonyms[bare]; ok {
			return k
		}
		return bare
	}
	return s
}

// traceMeasures carry no usable quantity by design — a cook adds them to taste.
// They are tracked separately from ordinary failures because the coverage
// contract exists to flag *material* gaps: a pinch of salt should not knock a
// fifth off a recipe's confidence.
var traceMeasures = map[string]bool{
	"pinch": true, "pinches": true,
	"dash": true, "dashes": true,
	"splash": true, "splashes": true,
	"handful": true, "handfuls": true,
	"sprinkle": true, "drizzle": true, "garnish": true,
	"to taste": true, "as needed": true, "as desired": true, "optional": true,
}

func isTraceMeasure(unit string) bool {
	return traceMeasures[strings.ToLower(strings.TrimSpace(unit))]
}

// extraVolumeMl covers volume measures the recipe normalization dictionary does
// not carry. FDC portions use them freely, so the resolver needs them to derive
// a density; they are not offered as ingredient-entry units.
var extraVolumeMl = map[string]float64{
	"fl oz":  29.5735,
	"pint":   473.176,
	"quart":  946.353,
	"gallon": 3785.41,
}

// densityPortions are the volume measures a density is derived from, largest
// first: a cup weighs enough that its published gram weight carries the least
// relative rounding error.
var densityPortions = []string{"cup", "l", "quart", "pint", "fl oz", "tbsp", "tsp", "ml"}

// countPortions are the per-piece measures tried, in order, for a line with no
// unit at all ("2 eggs"). "each" is explicit; the size words are what FDC
// actually publishes for whole produce, and "medium" is the fairest default
// when a recipe declines to say.
var countPortions = []string{"each", "medium", "piece", "large", "small", "serving"}
