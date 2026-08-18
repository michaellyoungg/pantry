package pricing

import (
	"regexp"
	"strconv"
	"strings"
)

// retailUnits are the pack units a retailer quotes shelf prices in. They are
// deliberately a separate table from unitFactors: that one mirrors
// internal/recipe's normalization.json unit-for-unit (see
// TestUnitFactorsMatchNormalization), and a recipe never says "1 gal" or
// "12 ct". Both tables convert to the same base units, so a pack size parsed
// here is directly comparable to a line quantity converted there.
var retailUnits = map[string]struct {
	dimension Dimension
	toBase    float64
}{
	"fl oz":  {DimensionVolume, 29.5735},
	"floz":   {DimensionVolume, 29.5735},
	"pt":     {DimensionVolume, 473.176},
	"pint":   {DimensionVolume, 473.176},
	"qt":     {DimensionVolume, 946.353},
	"quart":  {DimensionVolume, 946.353},
	"gal":    {DimensionVolume, 3785.41},
	"gallon": {DimensionVolume, 3785.41},
	"liter":  {DimensionVolume, 1000},
	"litre":  {DimensionVolume, 1000},
	"lbs":    {DimensionMass, 453.592},
	"pound":  {DimensionMass, 453.592},
	"pounds": {DimensionMass, 453.592},
	"ounce":  {DimensionMass, 28.3495},
	"ounces": {DimensionMass, 28.3495},
	"gram":   {DimensionMass, 1},
	"grams":  {DimensionMass, 1},
	"ct":     {DimensionCount, 1},
	"count":  {DimensionCount, 1},
	"pk":     {DimensionCount, 1},
	"pack":   {DimensionCount, 1},
	"ea":     {DimensionCount, 1},
	"each":   {DimensionCount, 1},
	"doz":    {DimensionCount, 12},
	"dozen":  {DimensionCount, 12},
}

// packPattern matches one "<number> <unit>" run. Units are matched greedily as
// a word run so "fl oz" beats "oz" — a 16 fl oz bottle and a 16 oz block of
// cheese differ by more than a factor of one.
var packPattern = regexp.MustCompile(`([0-9]+(?:\.[0-9]+)?)\s*([a-z]+(?:\s+[a-z]+)?)`)

// multipackSeparator splits "12 pk / 12 fl oz" into its two halves. Retailers
// quote multipacks this way and the total is the product, not either half.
const multipackSeparator = "/"

// ParsePackSize reads a retailer's free-text pack size into a dimension and a
// quantity in that dimension's base unit (grams, millilitres, or items).
//
// It is deliberately strict: ok=false for anything it does not recognise,
// because a misread pack size produces a confidently wrong shelf price, and the
// caller's fallback — the national average — is merely coarse.
func ParsePackSize(raw string) (dimension Dimension, base float64, ok bool) {
	s := strings.ToLower(strings.TrimSpace(raw))
	if s == "" {
		return "", 0, false
	}

	// A multipack multiplies a count by the size of one member: "12 pk / 12 fl
	// oz" is 144 fl oz. Only a leading count qualifies — "1 lb / 4 ct" would be
	// a pack described twice, not a multiplier.
	if left, right, found := strings.Cut(s, multipackSeparator); found {
		leftDim, leftQty, leftOK := parseOnePack(left)
		rightDim, rightQty, rightOK := parseOnePack(right)
		if leftOK && rightOK && leftDim == DimensionCount && rightDim != DimensionCount {
			return rightDim, leftQty * rightQty, true
		}
		if rightOK {
			return rightDim, rightQty, true
		}
		return leftDim, leftQty, leftOK
	}
	return parseOnePack(s)
}

func parseOnePack(s string) (Dimension, float64, bool) {
	for _, m := range packPattern.FindAllStringSubmatch(s, -1) {
		qty, err := strconv.ParseFloat(m[1], 64)
		if err != nil || qty <= 0 {
			continue
		}
		words := strings.Fields(m[2])
		// Try the two-word unit first ("fl oz"), then the one-word one.
		for i := len(words); i >= 1; i-- {
			if dim, toBase, found := lookupPackUnit(strings.Join(words[:i], " ")); found {
				return dim, qty * toBase, true
			}
		}
	}
	return "", 0, false
}

// lookupPackUnit resolves a pack unit through the recipe unit table first, so a
// unit both tables know can never disagree, then through the retail extras.
func lookupPackUnit(unit string) (Dimension, float64, bool) {
	if dim, toBase, ok := lookupUnit(unit); ok {
		return dim, toBase, true
	}
	u, ok := retailUnits[unit]
	if !ok {
		return "", 0, false
	}
	return u.dimension, u.toBase, true
}
