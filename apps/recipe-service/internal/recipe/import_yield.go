package recipe

import (
	"regexp"
	"strconv"
	"strings"
)

// maxServings bounds what we will accept as a serving count. A home recipe that
// genuinely feeds more than this does not exist on the sites we import from, so
// a larger bare number is far more likely a piece count that slipped past the
// unit check below.
const maxServings = 100

// servingWords are the yield units that unambiguously mean "portions for
// people". Any other unit ("loaf", "cookies", "cups") describes a yield but not
// a serving count, and BL-0035 would rather leave servings unknown than seed the
// nutrition track with a number that means something else.
var servingWords = map[string]bool{
	"serving":  true,
	"servings": true,
	"portion":  true,
	"portions": true,
	"person":   true,
	"people":   true,
	"adult":    true,
	"adults":   true,
	"guest":    true,
	"guests":   true,
}

// yieldFiller are leading tokens sites put in front of the number
// ("Serves 4", "Yield: 4 servings", "makes about 4"). They carry no quantity, so
// they are dropped before the number is read.
var yieldFiller = map[string]bool{
	"yield":         true,
	"yields":        true,
	"makes":         true,
	"serves":        true,
	"serving":       true,
	"size":          true,
	"about":         true,
	"approx":        true,
	"approximately": true,
	"around":        true,
	"up":            true,
	"to":            true,
}

// yieldLeadRe splits a leading run of digits off the first token, so "4-6"
// yields "4" and "-6".
var yieldLeadRe = regexp.MustCompile(`^(\d+)(.*)$`)

// yieldRangeRe matches the upper half of a range ("-6", "– 6", "to 6", "or 3").
// Ranges collapse to their lower bound, per BL-0035.
var yieldRangeRe = regexp.MustCompile(`^\s*(?:[-–—]|to|or)\s*\d+`)

// parseRecipeYield reads a schema.org recipeYield value and returns a serving
// count, or nil when the value is absent or is not confidently a count of
// servings. recipeYield is one of the loosest fields in the schema — it turns up
// as a number, a string, an array of either, or a QuantitativeValue — so every
// shape is handled and anything unrecognized falls through to nil.
func parseRecipeYield(v any) *int {
	switch t := v.(type) {
	case float64:
		return servingsFromNumber(t)
	case string:
		return servingsFromText(t)
	case []any:
		// Sites emit ["4", "4 servings"] or ["24 cookies", "4 servings"]; take
		// the first entry that reads as a serving count.
		for _, item := range t {
			if n := parseRecipeYield(item); n != nil {
				return n
			}
		}
	case map[string]any:
		return servingsFromQuantitativeValue(t)
	}
	return nil
}

// servingsFromQuantitativeValue reads {"@type":"QuantitativeValue","value":4,
// "unitText":"servings"}. A unit is only accepted when it names servings; a
// value carrying no unit at all is taken at face value, matching bare numbers.
func servingsFromQuantitativeValue(m map[string]any) *int {
	if unit := asString(m["unitText"]); unit != "" && !servingWords[strings.ToLower(unit)] {
		return nil
	}
	switch val := m["value"].(type) {
	case float64:
		return servingsFromNumber(val)
	case string:
		return servingsFromText(val)
	}
	return nil
}

func servingsFromNumber(f float64) *int {
	if f != float64(int(f)) { // "1.5 servings" is not a serving count we can store
		return nil
	}
	return boundedServings(int(f))
}

// servingsFromText parses the string forms: "4", "4 servings", "Serves 6",
// "Yield: 4 servings", "4-6 servings". It requires a leading integer and, when a
// unit follows, that the unit names servings.
func servingsFromText(raw string) *int {
	fields := strings.Fields(strings.ToLower(cleanText(raw)))
	for len(fields) > 0 && yieldFiller[trimYieldToken(fields[0])] {
		fields = fields[1:]
	}
	if len(fields) == 0 {
		return nil
	}
	m := yieldLeadRe.FindStringSubmatch(fields[0])
	if m == nil {
		return nil
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		return nil
	}

	rest := strings.TrimSpace(m[2] + " " + strings.Join(fields[1:], " "))
	rest = strings.TrimSpace(yieldRangeRe.ReplaceAllString(rest, ""))
	if rest == "" {
		// A bare number is a serving count by convention: "recipeYield": "4".
		return boundedServings(n)
	}
	// Only the unit immediately after the number decides it — trailing prose
	// ("4 servings (1 cup each)") is ignored, but "24 cookies" is rejected.
	if !servingWords[trimYieldToken(strings.Fields(rest)[0])] {
		return nil
	}
	return boundedServings(n)
}

// trimYieldToken strips the punctuation sites hang off yield tokens ("Yield:",
// "servings.", "(servings)").
func trimYieldToken(s string) string {
	return strings.Trim(s, ":.,;()[]")
}

func boundedServings(n int) *int {
	if n < 1 || n > maxServings {
		return nil
	}
	return &n
}
