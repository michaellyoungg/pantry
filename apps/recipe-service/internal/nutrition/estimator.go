package nutrition

import (
	"context"
	"log/slog"
	"time"
)

// Estimator wires the three pieces together: canonicalize each line, look up a
// food, resolve grams, then Compute.
//
// Estimate returns no error. Every failure mode this package has — no API key,
// rate limit reached, an ingredient nobody has data for — is a coverage fact,
// not a request failure. A recipe page should say "we could not account for the
// parsley", not 500.
type Estimator struct {
	norm      Normalizer
	provider  Provider
	resolver  *Resolver
	nutrients map[string]Nutrient
	now       func() time.Time
}

func NewEstimator(norm Normalizer, p Provider, nutrients map[string]Nutrient) *Estimator {
	return &Estimator{
		norm:      norm,
		provider:  p,
		resolver:  NewResolver(norm),
		nutrients: nutrients,
		now:       time.Now,
	}
}

// Estimate resolves every line and computes the recipe's nutrient vector.
// servings <= 0 means the yield is unknown, in which case per-serving figures
// are omitted rather than guessed.
func (e *Estimator) Estimate(ctx context.Context, lines []Line, servings float64) Estimate {
	return Compute(e.resolve(ctx, lines), e.nutrients, servings, e.now())
}

// resolve turns lines into resolutions. Split out so the multi-recipe rollup
// (EstimateGroups) reaches the totals down exactly this path — one lookup rule,
// one degradation rule, whether the caller asked about one recipe or a week.
func (e *Estimator) resolve(ctx context.Context, lines []Line) []Resolution {
	res := make([]Resolution, 0, len(lines))
	for _, ln := range lines {
		canonical, _, _ := e.norm.CanonicalItem(ln.Item)
		food, ok, err := e.provider.Lookup(ctx, canonical)
		if err != nil {
			// Degrade, never fail: this line goes unresolved and the coverage
			// report says so. Logged because a provider erroring on every lookup
			// should be visible as an incident, not as quietly bad nutrition.
			slog.WarnContext(ctx, "nutrition: food lookup failed",
				"canonicalItem", canonical, "err", err)
			food, ok = Food{}, false
		}
		res = append(res, e.resolver.Resolve(ln, food, ok))
	}
	return res
}
