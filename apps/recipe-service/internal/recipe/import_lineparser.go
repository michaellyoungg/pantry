package recipe

import (
	"regexp"
	"strconv"
	"strings"
)

// unicodeFractions maps the common single-rune fraction glyphs to their value.
var unicodeFractions = map[rune]float64{
	'½': 0.5, '⅓': 1.0 / 3, '⅔': 2.0 / 3, '¼': 0.25, '¾': 0.75,
	'⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1.0 / 6,
	'⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

// knownUnits maps recognized single-token unit words (lowercased) to a canonical
// label. Tokens not present here are treated as part of the item text. The set is
// deliberately broad: convertible measures (tsp/cup/g/…) plus the count-style
// units recipes lean on (clove, can, sprig, …). Downstream normalization only
// converts the measures it knows and passes the rest through as plain labels.
var knownUnits = map[string]string{
	"teaspoon": "tsp", "teaspoons": "tsp", "tsp": "tsp", "tsps": "tsp",
	"tablespoon": "tbsp", "tablespoons": "tbsp", "tbsp": "tbsp", "tbsps": "tbsp", "tbs": "tbsp", "tbl": "tbsp", "tbls": "tbsp",
	"cup": "cup", "cups": "cup",
	"ounce": "oz", "ounces": "oz", "oz": "oz",
	"pound": "lb", "pounds": "lb", "lb": "lb", "lbs": "lb",
	"gram": "g", "grams": "g", "g": "g",
	"kilogram": "kg", "kilograms": "kg", "kg": "kg",
	"milliliter": "ml", "milliliters": "ml", "millilitre": "ml", "millilitres": "ml", "ml": "ml",
	"liter": "l", "liters": "l", "litre": "l", "litres": "l", "l": "l",
	"quart": "qt", "quarts": "qt", "qt": "qt",
	"pint": "pt", "pints": "pt", "pt": "pt",
	"gallon": "gal", "gallons": "gal", "gal": "gal",
	"clove": "clove", "cloves": "clove",
	"can": "can", "cans": "can",
	"jar": "jar", "jars": "jar",
	"bottle": "bottle", "bottles": "bottle",
	"bag": "bag", "bags": "bag",
	"box": "box", "boxes": "box",
	"package": "package", "packages": "package", "pkg": "package", "pkgs": "package",
	"container": "container", "containers": "container",
	"stick": "stick", "sticks": "stick",
	"pinch": "pinch", "pinches": "pinch",
	"dash": "dash", "dashes": "dash",
	"handful": "handful", "handfuls": "handful",
	"slice": "slice", "slices": "slice",
	"piece": "piece", "pieces": "piece",
	"sheet": "sheet", "sheets": "sheet",
	"sprig": "sprig", "sprigs": "sprig",
	"stalk": "stalk", "stalks": "stalk",
	"rib": "rib", "ribs": "rib",
	"bunch": "bunch", "bunches": "bunch",
	"head": "head", "heads": "head",
	"fillet": "fillet", "fillets": "fillet",
	// "4 ears fresh corn", "1 rack baby back ribs" — count units that were
	// missing, so the whole line landed in the item text and could never
	// resolve to a canonical item (found by the BL-0031 coverage report).
	"ear": "ear", "ears": "ear",
	"rack": "rack", "racks": "rack",
	"drop": "drop", "drops": "drop",
	"knob": "knob", "knobs": "knob",
}

// multiWordUnits maps space-joined multi-token unit phrases (lowercased) to a
// canonical label. Checked before the single-token table so "fluid ounce" is not
// misread as the mass unit "ounce".
var multiWordUnits = map[string]string{
	"fluid ounce": "fl oz", "fluid ounces": "fl oz", "fl oz": "fl oz",
}

// parenClauseRe matches a parenthetical clause, e.g. "(15-ounce)" or
// "(about 2 lbs, trimmed)". These are supplementary notes on recipe sites and
// would otherwise sit between the quantity and the unit ("1 (15-ounce) can …"),
// hiding the real unit. Stripping them lets the unit be recognized.
var parenClauseRe = regexp.MustCompile(`\s*\([^)]*\)`)

// gluedUnitRe splits a leading token that fuses a number and a unit, e.g. "500g"
// or "2tbsp" — common in metric JSON-LD. Group 1 is the numeric part (including
// a decimal), group 2 the alphabetic suffix, which must still resolve via
// knownUnits before the split is accepted.
var gluedUnitRe = regexp.MustCompile(`^([0-9]+(?:\.[0-9]+)?)([a-zA-Z]+)$`)

// parseIngredientLine turns "2 cloves garlic, minced" into a structured
// Ingredient. A trailing comma clause becomes the note. A line with no leading
// quantity yields quantity 0, empty unit, and the whole line as the item — the
// normalizer already tolerates unknown items/units, so nothing breaks downstream.
func parseIngredientLine(line string) Ingredient {
	line = strings.TrimSpace(parenClauseRe.ReplaceAllString(strings.TrimSpace(line), " "))
	note := ""
	if i := strings.IndexByte(line, ','); i >= 0 {
		note = strings.TrimSpace(line[i+1:])
		line = strings.TrimSpace(line[:i])
	}
	tokens := splitGluedLeadingUnit(strings.Fields(line))
	qty, rest, ok := parseQuantity(tokens)
	if !ok {
		return Ingredient{Item: strings.TrimSpace(line), Note: note}
	}
	unit, rest := takeUnit(rest)
	// A leading "of" ("3 cloves of garlic") is a filler word once the unit is gone.
	if len(rest) > 0 && strings.EqualFold(rest[0], "of") {
		rest = rest[1:]
	}
	return Ingredient{Quantity: qty, Unit: unit, Item: strings.Join(rest, " "), Note: note}
}

// takeUnit consumes a leading unit from rest, trying a two-token phrase first
// (e.g. "fluid ounces") then a single token. It returns the canonical unit label
// ("" when none matches) and the remaining tokens.
func takeUnit(rest []string) (string, []string) {
	if len(rest) >= 2 {
		phrase := strings.ToLower(strings.Trim(rest[0], ".") + " " + strings.Trim(rest[1], "."))
		if u, ok := multiWordUnits[phrase]; ok {
			return u, rest[2:]
		}
	}
	if len(rest) > 0 {
		if u, ok := knownUnits[strings.ToLower(strings.Trim(rest[0], "."))]; ok {
			return u, rest[1:]
		}
	}
	return "", rest
}

// splitGluedLeadingUnit expands a leading "500g"/"2tbsp" token into two tokens
// when the alphabetic suffix is a recognized unit. All other token lists are
// returned unchanged.
func splitGluedLeadingUnit(tokens []string) []string {
	if len(tokens) == 0 {
		return tokens
	}
	m := gluedUnitRe.FindStringSubmatch(tokens[0])
	if m == nil {
		return tokens
	}
	if _, ok := knownUnits[strings.ToLower(m[2])]; !ok {
		return tokens
	}
	out := make([]string, 0, len(tokens)+1)
	out = append(out, m[1], m[2])
	return append(out, tokens[1:]...)
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
// Hyphen, en-dash, and em-dash all delimit a range.
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
	if i := strings.IndexAny(tok, "-–—"); i > 0 { // range → low value
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
