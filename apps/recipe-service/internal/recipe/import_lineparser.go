package recipe

import (
	"strconv"
	"strings"
)

// unicodeFractions maps the common single-rune fraction glyphs to their value.
var unicodeFractions = map[rune]float64{
	'½': 0.5, '⅓': 1.0 / 3, '⅔': 2.0 / 3, '¼': 0.25, '¾': 0.75,
	'⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1.0 / 6,
	'⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

// knownUnits maps recognized unit tokens (lowercased) to a canonical label.
// Tokens not present here are treated as part of the item text.
var knownUnits = map[string]string{
	"teaspoon": "tsp", "teaspoons": "tsp", "tsp": "tsp", "tsps": "tsp",
	"tablespoon": "tbsp", "tablespoons": "tbsp", "tbsp": "tbsp", "tbsps": "tbsp",
	"cup": "cup", "cups": "cup",
	"ounce": "oz", "ounces": "oz", "oz": "oz",
	"pound": "lb", "pounds": "lb", "lb": "lb", "lbs": "lb",
	"gram": "g", "grams": "g", "g": "g",
	"kilogram": "kg", "kilograms": "kg", "kg": "kg",
	"milliliter": "ml", "milliliters": "ml", "ml": "ml",
	"liter": "l", "liters": "l", "l": "l",
	"clove": "clove", "cloves": "clove",
	"can": "can", "cans": "can",
	"pinch": "pinch", "pinches": "pinch",
	"slice": "slice", "slices": "slice",
}

// parseIngredientLine turns "2 cloves garlic, minced" into a structured
// Ingredient. A trailing comma clause becomes the note. A line with no leading
// quantity yields quantity 0, empty unit, and the whole line as the item — the
// normalizer already tolerates unknown items/units, so nothing breaks downstream.
func parseIngredientLine(line string) Ingredient {
	line = strings.TrimSpace(line)
	note := ""
	if i := strings.IndexByte(line, ','); i >= 0 {
		note = strings.TrimSpace(line[i+1:])
		line = strings.TrimSpace(line[:i])
	}
	tokens := strings.Fields(line)
	qty, rest, ok := parseQuantity(tokens)
	if !ok {
		return Ingredient{Item: line, Note: note}
	}
	unit := ""
	if len(rest) > 0 {
		if u, isUnit := knownUnits[strings.ToLower(strings.Trim(rest[0], "."))]; isUnit {
			unit = u
			rest = rest[1:]
		}
	}
	return Ingredient{Quantity: qty, Unit: unit, Item: strings.Join(rest, " "), Note: note}
}

// parseQuantity reads a leading quantity, including a "1 1/2" whole+fraction pair.
func parseQuantity(tokens []string) (float64, []string, bool) {
	if len(tokens) == 0 {
		return 0, tokens, false
	}
	total, ok := parseNumberToken(tokens[0])
	if !ok {
		return 0, tokens, false
	}
	rest := tokens[1:]
	if len(rest) > 0 {
		if frac, isFrac := parseFractionOnly(rest[0]); isFrac {
			total += frac
			rest = rest[1:]
		}
	}
	return total, rest, true
}

// parseNumberToken parses "1", "1.5", "1/2", "1-2" (range low), "½", or "1½".
func parseNumberToken(tok string) (float64, bool) {
	if tok == "" {
		return 0, false
	}
	runes := []rune(tok)
	var extra float64
	if f, ok := unicodeFractions[runes[len(runes)-1]]; ok {
		extra = f
		tok = string(runes[:len(runes)-1])
		if tok == "" {
			return extra, true // bare "½"
		}
	}
	if i := strings.IndexByte(tok, '-'); i > 0 { // range → low value
		tok = tok[:i]
	}
	if f, ok := parseFractionOnly(tok); ok {
		return f + extra, true
	}
	if v, err := strconv.ParseFloat(tok, 64); err == nil {
		return v + extra, true
	}
	return 0, false
}

// parseFractionOnly parses "3/4" into 0.75. False if the token is not a fraction.
func parseFractionOnly(tok string) (float64, bool) {
	i := strings.IndexByte(tok, '/')
	if i <= 0 || i == len(tok)-1 {
		return 0, false
	}
	num, err1 := strconv.ParseFloat(tok[:i], 64)
	den, err2 := strconv.ParseFloat(tok[i+1:], 64)
	if err1 != nil || err2 != nil || den == 0 {
		return 0, false
	}
	return num / den, true
}
