package nutrition

import "context"

// The multi-recipe rollup (BL-0037): several recipes' worth of lines estimated
// in one pass, so a meal plan gets one nutrient vector instead of N.
//
// The load-bearing decision here is that a rollup resolves *lines*, not
// estimates. Merging finished Estimates would be simpler and would be wrong: a
// recipe that resolves nothing has a mass fraction of 0 with no recoverable
// denominator, so summing fractions makes a wholly unaccounted-for dish vanish
// from the arithmetic — the exact silent under-report this feature exists to
// prevent. Resolving every line first keeps unresolved mass in the denominator
// where it belongs.

// Group is one recipe's contribution to a rollup: its ingredient lines, already
// scaled by the caller's servings multiplier, under an id the caller uses to
// match the per-group result back to its recipe.
type Group struct {
	ID    string
	Lines []Line
}

// GroupCoverage is one group's own coverage within a rollup, returned in call
// order so the caller can zip it back onto its inputs.
type GroupCoverage struct {
	ID       string
	Coverage Coverage
}

// EstimateGroups resolves every group's lines and returns one combined Estimate
// plus each group's individual coverage.
//
// The combined Estimate carries no servings and therefore no per-serving
// figures: a plan has no yield, and "per serving of a Tuesday" is not a number
// anyone should be shown. Divide by days, not by a guess.
func (e *Estimator) EstimateGroups(ctx context.Context, groups []Group) (Estimate, []GroupCoverage) {
	all := make([]Resolution, 0, len(groups))
	covs := make([]GroupCoverage, 0, len(groups))
	at := e.now()

	for _, g := range groups {
		res := e.resolve(ctx, g.Lines)
		covs = append(covs, GroupCoverage{
			ID:       g.ID,
			Coverage: Compute(res, e.nutrients, 0, at).Coverage,
		})
		all = append(all, res...)
	}
	return Compute(all, e.nutrients, 0, at), covs
}
