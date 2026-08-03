package nutrition

import (
	"math"
	"sort"
	"time"
)

// Compute turns resolved ingredient lines into an Estimate.
//
// It is pure — no I/O, no clock, no globals. `servings` and `at` are supplied by
// the caller precisely so the interesting arithmetic (totals, per-serving
// division, coverage) is testable without a database or a network.
//
// servings <= 0 means the yield is unknown: totals are still returned and
// PerServing is omitted, rather than divided by a guess.
func Compute(res []Resolution, nutrients map[string]Nutrient, servings float64, at time.Time) Estimate {
	totals := map[string]float64{}
	ings := make([]IngredientEstimate, 0, len(res))

	var resolvedMass, knownMass float64
	var knownMasses []float64
	resolvedCount, unknownCount := 0, 0

	for _, r := range res {
		ie := IngredientEstimate{
			Item:     r.Line.Item,
			Resolved: r.Resolved(),
			Reason:   r.Reason,
			Method:   r.Method,
		}
		if r.Matched {
			ie.MatchedFood = r.Food.Description
		}
		if r.GramsKnown {
			g := round(r.Grams, 2)
			ie.Grams = &g
			knownMass += r.Grams
			knownMasses = append(knownMasses, r.Grams)
		} else if !r.Trace {
			// Trace measures are excluded from the imputed mass below; an
			// ordinary failure is not.
			unknownCount++
		}
		if r.Resolved() {
			resolvedCount++
			resolvedMass += r.Grams
			for id, per100 := range r.Food.Nutrients {
				totals[id] += per100 * r.Grams / 100
			}
		}
		ings = append(ings, ie)
	}

	est := Estimate{
		Nutrients:   amounts(totals, nutrients, 1),
		Servings:    servings,
		Ingredients: ings,
		EstimatedAt: at.UTC(),
		Coverage: Coverage{
			ResolvedMassFraction: massFraction(resolvedMass, knownMass, knownMasses, unknownCount),
			ResolvedCount:        resolvedCount,
			TotalCount:           len(res),
		},
	}
	if servings > 0 {
		est.PerServing = amounts(totals, nutrients, servings)
	}
	return est
}

// massFraction reports how much of the recipe's mass the estimate accounts for.
//
// Lines whose mass we know sit in the denominator at their true weight, whether
// or not they contributed nutrients. Lines whose mass we do not know have to be
// imputed — by definition there is no true value to use — and the median known
// line is the least-assuming stand-in available. Trace measures are excluded
// from the imputation entirely: the design's coverage contract exists to flag
// material gaps, and a pinch of salt is not one.
func massFraction(resolvedMass, knownMass float64, knownMasses []float64, unknownCount int) float64 {
	denom := knownMass + float64(unknownCount)*median(knownMasses)
	if denom <= 0 {
		return 0
	}
	return round(resolvedMass/denom, 4)
}

func median(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	mid := len(s) / 2
	if len(s)%2 == 1 {
		return s[mid]
	}
	return (s[mid-1] + s[mid]) / 2
}

// amounts renders the accumulated vector, divided by `divisor` (1 for totals,
// the servings count for per-serving). A nutrient with no reference row still
// comes through with an empty unit — the map is open by design, so an unknown
// id is data we have not catalogued yet, not an error.
func amounts(totals map[string]float64, nutrients map[string]Nutrient, divisor float64) map[string]NutrientAmount {
	out := make(map[string]NutrientAmount, len(totals))
	for id, v := range totals {
		out[id] = NutrientAmount{NutrientID: id, Amount: round(v/divisor, 3), Unit: nutrients[id].Unit}
	}
	return out
}

// round trims the float noise that accumulates over a dozen multiplications, so
// the wire carries 4.47 rather than 4.470000000000001.
func round(v float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.Round(v*p) / p
}
