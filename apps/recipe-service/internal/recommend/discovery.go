package recommend

import (
	"fmt"
	"strings"
)

// --- Discovery-facet scoring (BL-0030) ----------------------------------
//
// `cuisineMatch` and `timeFit` are the two features the recommendations design
// (BL-0005) specified and could not turn on: a Recipe carried no facets, so
// there was nothing to score a stated taste against. BL-0020 added the facets;
// this file finally reads them.
//
// Two rules are load-bearing here, and both are about ABSENCE:
//
//   - An UNKNOWN cook time matches no time bucket. A recipe nobody timed is not
//     a fast recipe, and scoring it as one would put every untimed recipe at the
//     top of "I have 20 minutes" — the single worst failure this feature has.
//     The catalog filter chips already refuse the same inference
//     (apps/web/src/components/CatalogFilters.tsx); the ranker now agrees.
//   - An UNTAGGED recipe is unmeasured, not bad. Following BL-0040's nutrition
//     precedent, a missing facet makes the feature `available: false`, so it
//     leaves both sides of combine()'s average untouched. Scoring it as a zero
//     would quietly bury every recipe predating the facets — which is most of
//     them, and all of the user's own.
//
// The distinction that makes the second rule sharp: absence of DATA is
// unavailable, while a facet we measured and the user did not ask for is a real
// observation and scores zero. So an Italian recipe ranks below an untagged one
// for someone who asked for Thai — we know it is not what they wanted, and we
// do not know that about the untagged one.

// timeFitFloor is the multiple of the user's limit at which a recipe stops
// scoring on time at all. Beyond it the fit is 0 rather than negative: this is
// a preference, not a constraint, and a long braise is not a penalty against the
// rest of the recipe's merits.
const timeFitFloor = 2

// timeFitValue scores a KNOWN cook time against a KNOWN limit, in [0, 1].
//
// Everything inside the limit is a full fit — asking for "under 30 minutes" is
// asking for a ceiling, not for the fastest possible dish, and a 10-minute
// recipe is not twice as good an answer as a 25-minute one. Past the ceiling the
// fit decays linearly to 0 at twice the limit, so 35 minutes on a 30-minute
// budget still ranks near a dish that fits, while a 3-hour braise does not.
//
// Callers must not reach here with an unknown time or a non-positive limit; see
// discoveryFeatures, which is what decides those are unavailable.
func timeFitValue(totalMinutes, maxMinutes int) float64 {
	if totalMinutes <= maxMinutes {
		return 1
	}
	over := float64(totalMinutes - maxMinutes)
	fit := 1 - over/float64(maxMinutes*(timeFitFloor-1))
	if fit < 0 {
		return 0
	}
	return fit
}

// discoveryMatch is what one candidate's facets look like against one user's
// stated tastes, computed once so the features and the reasons cannot disagree
// about whether something matched.
type discoveryMatch struct {
	// cuisineScored is false when either side is silent: no stated taste, or an
	// untagged recipe.
	cuisineScored bool
	cuisineHit    bool
	// timeScored is false for an unknown cook time or an absent limit.
	timeScored bool
	timeFit    float64
	minutes    int
	cuisine    string
}

func matchDiscovery(c Candidate, p Preferences) discoveryMatch {
	var d discoveryMatch

	// Slugs on both sides come from the same open vocabulary (BL-0020), but the
	// preference side is stored from free text, so fold case before comparing
	// rather than trusting a client to have normalized.
	if len(p.Cuisines) > 0 && c.Cuisine != "" {
		d.cuisineScored = true
		d.cuisine = c.Cuisine
		want := strings.ToLower(strings.TrimSpace(c.Cuisine))
		for _, pref := range p.Cuisines {
			if strings.ToLower(strings.TrimSpace(pref)) == want {
				d.cuisineHit = true
				break
			}
		}
	}

	// A non-positive limit is a cleared field, not a demand that nothing
	// qualifies — it degrades to "no preference".
	if p.MaxMinutes != nil && *p.MaxMinutes > 0 && c.TotalMinutes != nil {
		d.timeScored = true
		d.minutes = *c.TotalMinutes
		d.timeFit = timeFitValue(*c.TotalMinutes, *p.MaxMinutes)
	}

	return d
}

func discoveryFeatures(d discoveryMatch, w Weights) []feature {
	var cuisineValue float64
	if d.cuisineHit {
		cuisineValue = 1
	}
	return []feature{
		{
			name:      "cuisineMatch",
			value:     cuisineValue,
			weight:    w.CuisineMatch,
			available: d.cuisineScored,
		},
		{
			name:      "timeFit",
			value:     d.timeFit,
			weight:    w.TimeFit,
			available: d.timeScored,
		},
	}
}

// discoveryReasons explains the facets, and only ever claims what was actually
// scored. A recipe over the user's limit gets no time line: "Ready in 90 min"
// beside a 30-minute request reads as a boast about missing the point.
func discoveryReasons(d discoveryMatch) []string {
	var out []string
	if d.cuisineHit {
		out = append(out, fmt.Sprintf("%s, one of your favourites", humanizeSlug(d.cuisine)))
	}
	if d.timeScored && d.timeFit == 1 {
		out = append(out, fmt.Sprintf("Ready in %d min", d.minutes))
	}
	return out
}

// humanizeSlug renders a stored slug as a label: "south-indian" → "South
// Indian". It mirrors humanizeSlug in apps/web/src/lib/discovery.ts, which does
// the same job for the catalog chips — a reason string and a filter chip naming
// the same cuisine differently would read as two different cuisines.
func humanizeSlug(slug string) string {
	parts := strings.Split(slug, "-")
	for i, p := range parts {
		if p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	return strings.Join(parts, " ")
}
