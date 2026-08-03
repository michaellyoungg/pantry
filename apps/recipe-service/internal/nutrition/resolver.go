package nutrition

import "fmt"

// Resolution is one ingredient line after gram resolution.
//
// It separates two facts that are easy to conflate and expensive to conflate:
// whether we know the line's *mass*, and whether the line contributes
// *nutrients*. "500 g of something we have no data for" has a known mass and
// contributes nothing — counting it as covered is exactly how a nutrition
// feature ends up confidently wrong.
type Resolution struct {
	Line       Line
	Grams      float64
	GramsKnown bool
	Food       Food
	Matched    bool
	Method     string
	Reason     string
	// Trace marks a measure that is negligible by nature ("pinch", "to taste")
	// rather than one we simply failed to convert.
	Trace bool
}

// Resolved reports whether the line contributes nutrients to the estimate.
func (r Resolution) Resolved() bool {
	return r.GramsKnown && r.Matched && len(r.Food.Nutrients) > 0
}

// Resolver converts ingredient lines to grams. Mass units convert through the
// recipe normalization dictionary alone; volume and count need the matched
// food's published portion weights, which is the whole reason FDC is the data
// source.
type Resolver struct{ norm Normalizer }

func NewResolver(n Normalizer) *Resolver { return &Resolver{norm: n} }

// Resolve converts one line. It never returns an error: an unconvertible line is
// a Resolution with a reason, because "we could not account for the parsley" is
// a result the UI must render, not a failure that should sink the request.
func (r *Resolver) Resolve(line Line, food Food, matched bool) Resolution {
	res := Resolution{Line: line, Food: food, Matched: matched}
	r.grams(&res)
	// A weighed line with no food behind it: the mass stands, the nutrients do
	// not. Say so specifically rather than reusing the mass failure's reason.
	if res.GramsKnown && !res.Resolved() {
		res.Reason = fmt.Sprintf("no nutrition data for %q", line.Item)
	}
	return res
}

func (r *Resolver) grams(res *Resolution) {
	line := res.Line
	unit := portionKey(line.Unit)

	// Checked before the quantity, because "to taste" usually arrives with a
	// quantity of zero and deserves the accurate reason rather than the generic
	// one.
	if isTraceMeasure(line.Unit) {
		res.Trace = true
		res.Reason = fmt.Sprintf("%q is a trace measure with no gram weight", line.Unit)
		return
	}
	if line.Quantity <= 0 {
		res.Reason = fmt.Sprintf("no quantity given for %q", line.Item)
		return
	}

	// 1. Mass. The only path that needs no food data at all, so it runs before
	//    the match gate — a weighed ingredient's mass is knowable regardless.
	if dim, toBase, ok := r.norm.Unit(unit); ok && dim == dimMass {
		res.Grams, res.GramsKnown, res.Method = line.Quantity*toBase, true, MethodMass
		return
	}

	if !res.Matched {
		res.Reason = fmt.Sprintf("no food match for %q", line.Item)
		return
	}

	// 2. The exact household measure the food publishes ("1 cup" of flour,
	//    "1 clove" of garlic). Preferred over the density path even for volumes:
	//    it is the number USDA measured, not one we divided our way to.
	if unit != "" {
		if g, ok := res.Food.Portions[unit]; ok && g > 0 {
			res.Grams, res.GramsKnown, res.Method = line.Quantity*g, true, MethodPortion
			return
		}
	}

	// 3. A volume the food does not publish, crossed to mass through a density
	//    derived from a volume measure it does.
	if ml, ok := r.volumeMl(unit); ok {
		if d, ok := r.density(res.Food); ok {
			res.Grams, res.GramsKnown, res.Method = line.Quantity*ml*d, true, MethodDensity
			return
		}
		res.Reason = fmt.Sprintf("no gram weight for a volume of %q", line.Item)
		return
	}

	// 4. Countable. A bare quantity ("2 eggs") looks for a per-piece weight.
	if unit == "" {
		if g, ok := countPortion(res.Food); ok {
			res.Grams, res.GramsKnown, res.Method = line.Quantity*g, true, MethodCount
			return
		}
		res.Reason = fmt.Sprintf("no per-piece gram weight for %q", line.Item)
		return
	}

	res.Reason = fmt.Sprintf("no gram weight for unit %q on %q", line.Unit, line.Item)
}

// volumeMl reports how many millilitres one of unit is, consulting the recipe
// dictionary first so the two stay in step, then the measures only FDC uses.
func (r *Resolver) volumeMl(unit string) (float64, bool) {
	if dim, toBase, ok := r.norm.Unit(unit); ok && dim == dimVolume {
		return toBase, true
	}
	ml, ok := extraVolumeMl[unit]
	return ml, ok
}

// density derives grams per millilitre from whichever volume measure the food
// publishes. Flour at 125 g/cup is 0.528 g/ml, which is what makes "3 tbsp of
// flour" answerable from a cup weight.
func (r *Resolver) density(food Food) (float64, bool) {
	for _, k := range densityPortions {
		g, ok := food.Portions[k]
		if !ok || g <= 0 {
			continue
		}
		if ml, ok := r.volumeMl(k); ok && ml > 0 {
			return g / ml, true
		}
	}
	return 0, false
}

// countPortion picks the per-piece gram weight for a line that gave no unit.
func countPortion(food Food) (float64, bool) {
	for _, k := range countPortions {
		if g, ok := food.Portions[k]; ok && g > 0 {
			return g, true
		}
	}
	return 0, false
}
