package recommend

import "math"

// --- Nutrition-aware scoring (BL-0040) ----------------------------------
//
// This is ONE MORE SCORING INPUT, not a second recommender. Everything here
// feeds the same `feature`/`combine` machinery the pantry signal uses, which is
// what makes filtering and ranking two readings of a single score rather than
// two systems that can disagree.
//
// Three rules are load-bearing and should not be "simplified" away:
//
//   - The OPERATOR does not decide filtering. `<= 200mg cholesterol` is a
//     preference for one user and a medical limit for another, and only the user
//     knows which — so a hard constraint is the `Hard` flag, nothing else.
//   - Unknown or low-coverage nutrition is NEUTRAL, never a penalty. Scoring a
//     data gap as "bad" would quietly bury every recipe whose ingredients failed
//     to resolve. The `available: false` path in combine() already expresses
//     exactly this, so nutrition reuses it rather than inventing a fallback.
//   - A candidate is judged against what the plan STILL NEEDS, not against the
//     target in isolation. That is what makes a week's protein goal reachable by
//     a set of dishes none of which reaches it alone.

// Operators, mirroring the `nutritionTargets` union in the Convex schema.
const (
	opAtLeast = ">="
	opAtMost  = "<="
	opAbout   = "=="
)

// periodWeek is the only period with a running total to net a candidate off.
// The union also holds "day" and "meal"; both judge the dish on its own, so
// they need no constant here.
const periodWeek = "week"

// coverageThreshold mirrors NUTRITION_COVERAGE_THRESHOLD in @pantry/core. Below
// it, an estimate describes too little of the food to support a claim, so both
// the evaluator (BL-0038) and this scorer answer "unknown" rather than guess.
const coverageThreshold = 0.8

// equalityBand mirrors EQUALITY_BAND in @pantry/core: how close an `==` target
// has to be to count as met, as a fraction of the target value. These are
// estimates of as-purchased ingredients, so exact equality is unreachable.
const equalityBand = 0.02

// NutritionTarget is one of the user's declarative goals (BL-0038) plus the one
// field BL-0040 adds.
type NutritionTarget struct {
	// NutrientID is an FDC nutrient number ("1003" protein, "1253"
	// cholesterol) — the same key the estimate is written in, so scoring is a
	// map lookup rather than a taxonomy translation.
	NutrientID string  `json:"nutrientId"`
	Operator   string  `json:"operator"`
	Value      float64 `json:"value"`
	Period     string  `json:"period"`
	Label      string  `json:"label,omitempty"`
	// Hard promotes this target from a ranking signal to a filter. Paused
	// targets never reach here — the caller sends active rows only.
	Hard bool `json:"hard,omitempty"`
}

// NutritionCoverage mirrors nutrition.Coverage: the honest account of how much
// of the food an estimate actually covers.
type NutritionCoverage struct {
	ResolvedMassFraction float64 `json:"resolvedMassFraction"`
	ResolvedCount        int     `json:"resolvedCount"`
	TotalCount           int     `json:"totalCount"`
}

// CandidateNutrition is one candidate's PER-SERVING nutrient vector.
//
// Per serving, not per recipe: a recommendation is an invitation to eat one
// portion, and a recipe that feeds six is not six times the cholesterol on your
// plate. A candidate whose yield is unknown (BL-0035) has no per-serving figure
// at all and therefore arrives here as nil — unmeasured, not zero.
type CandidateNutrition struct {
	PerServing map[string]float64 `json:"perServing"`
	Coverage   NutritionCoverage  `json:"coverage"`
}

// amount reports this candidate's contribution for one nutrient, and whether it
// is measurable at all. Every "we cannot say" path funnels through here.
func (n *CandidateNutrition) amount(nutrientID string) (float64, bool) {
	if n == nil || n.Coverage.TotalCount == 0 {
		return 0, false
	}
	if n.Coverage.ResolvedMassFraction < coverageThreshold {
		return 0, false
	}
	// Coverage measures resolved MASS, not nutrient completeness: a food matched
	// without a cholesterol figure is not a food with no cholesterol.
	amt, ok := n.PerServing[nutrientID]
	return amt, ok
}

// PlanNutrition is what the week's plan ALREADY commits — the running total a
// candidate is netted off, and the reason this scorer is set-level.
type PlanNutrition struct {
	Nutrients map[string]float64 `json:"nutrients"`
	Coverage  NutritionCoverage  `json:"coverage"`
}

// committed reports the plan's running total for one nutrient, and whether that
// total is trustworthy. An untrustworthy total is not a zero: treating it as one
// would let a hard cap pass on a week we could not actually measure.
func (p *PlanNutrition) committed(nutrientID string) (float64, bool) {
	if p == nil {
		return 0, false
	}
	// An empty plan genuinely commits nothing. That is knowledge, not a gap.
	if p.Coverage.TotalCount == 0 {
		return 0, true
	}
	if p.Coverage.ResolvedMassFraction < coverageThreshold {
		return 0, false
	}
	amt, ok := p.Nutrients[nutrientID]
	return amt, ok
}

// UnverifiedConstraint names a HARD constraint a candidate could not be checked
// against, so the UI can say "we could not check this" instead of implying a
// pass. It carries the nutrient id rather than a rendered string because only
// the client has the nutrient catalog to name it with.
type UnverifiedConstraint struct {
	NutrientID string `json:"nutrientId"`
	Label      string `json:"label,omitempty"`
}

// targetVerdict is one candidate judged against one target.
type targetVerdict struct {
	// scored reports whether this target contributed a fit. A target that could
	// not be measured, or that the plan already satisfies, contributes nothing —
	// it is not a zero.
	scored bool
	fit    float64
	// violates means a hard constraint was measurably broken.
	violates bool
	// unverified means a hard constraint could not be checked at all.
	unverified bool
}

// assessTarget scores one target. The shape of every branch is the same: work
// out what the period still has room for (a cap) or still needs (a floor), then
// ask how much of that the candidate's serving covers.
func assessTarget(t NutritionTarget, c *CandidateNutrition, plan *PlanNutrition) targetVerdict {
	contribution, measured := c.amount(t.NutrientID)
	if !measured {
		// Neutral in ranking — and named as unchecked when it was a constraint,
		// because "we never looked" must not read as "it passed".
		return targetVerdict{unverified: t.Hard}
	}

	// Only a `week` target has a running total to net off. A candidate has no
	// assigned weekday, so a `day` or `meal` target judges the dish alone;
	// subtracting a whole week's commitment from a single day's allowance would
	// condemn every candidate from Wednesday onward.
	committed, commitmentKnown := 0.0, true
	if t.Period == periodWeek {
		committed, commitmentKnown = plan.committed(t.NutrientID)
		if !commitmentKnown {
			committed = 0
		}
	}
	remaining := t.Value - committed

	var v targetVerdict
	switch t.Operator {
	case opAtLeast:
		if remaining <= 0 {
			// The plan already clears the floor. Every candidate is equally fine
			// on this goal, so there is no signal here to rank on.
			return targetVerdict{}
		}
		v = targetVerdict{scored: true, fit: clamp01(contribution / remaining)}
		// A floor cannot be broken by adding food, so a hard `>=` never filters.
	case opAtMost:
		v = targetVerdict{scored: true, violates: contribution > remaining}
		if remaining > 0 {
			v.fit = clamp01(1 - contribution/remaining)
		}
	case opAbout:
		v = targetVerdict{
			scored:   true,
			violates: contribution > remaining+math.Abs(t.Value)*equalityBand,
		}
		if remaining > 0 {
			// Peaks where the candidate lands exactly on what is still wanted,
			// and falls away in both directions.
			v.fit = math.Min(contribution, remaining) / math.Max(contribution, remaining)
		}
	default:
		// An operator we do not understand is not a verdict we should invent.
		return targetVerdict{}
	}

	if !t.Hard {
		v.violates = false
	} else if !commitmentKnown {
		// We can measure the dish but not the week it joins. Rank on it, refuse
		// to filter on a running total we made up, and say so.
		v.violates, v.unverified = false, true
	}
	return v
}

// nutritionAssessment is a candidate judged against the whole target set.
type nutritionAssessment struct {
	fit        float64
	scored     int
	violates   bool
	unverified []UnverifiedConstraint
}

// assess folds the per-target verdicts into one.
//
// Targets AVERAGE rather than multiply, so one nutrient nobody has data for
// cannot silence the ones we can measure.
func assess(targets []NutritionTarget, c *CandidateNutrition, plan *PlanNutrition) nutritionAssessment {
	var a nutritionAssessment
	var sum float64
	for _, t := range targets {
		v := assessTarget(t, c, plan)
		if v.violates {
			a.violates = true
		}
		if v.unverified {
			a.unverified = append(a.unverified,
				UnverifiedConstraint{NutrientID: t.NutrientID, Label: t.Label})
		}
		if v.scored {
			a.scored++
			sum += v.fit
		}
	}
	if a.scored > 0 {
		a.fit = sum / float64(a.scored)
	}
	return a
}

// nutritionFeature turns the assessment into a scoring feature. `available` is
// the whole coverage-honesty story in one field: with nothing measurable, the
// feature leaves both sides of the average untouched (see combine).
func nutritionFeature(a nutritionAssessment, w Weights) feature {
	return feature{
		name:      "nutritionFit",
		value:     a.fit,
		weight:    w.NutritionFit,
		available: a.scored > 0,
	}
}

// nutritionReasonThreshold is how good the fit has to be before we claim it in
// the UI. A mediocre fit still ranks; it just does not get to boast.
const nutritionReasonThreshold = 0.6

func nutritionReason(a nutritionAssessment) string {
	if a.scored == 0 || a.fit < nutritionReasonThreshold {
		return ""
	}
	return "Fits your nutrition goals"
}

// nonNilUnverified guarantees a slice that marshals to `[]`, never `null` — see
// nonNilStrings.
func nonNilUnverified(xs []UnverifiedConstraint) []UnverifiedConstraint {
	if xs == nil {
		return []UnverifiedConstraint{}
	}
	return xs
}

func clamp01(x float64) float64 {
	if x < 0 {
		return 0
	}
	if x > 1 {
		return 1
	}
	return x
}
