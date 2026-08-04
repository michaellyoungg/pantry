package recipe

import (
	"regexp"
	"strconv"
	"strings"
)

// schema.org durations are ISO-8601 ("PT1H30M"). Sites are sloppy about it:
// lowercase, a stray date part ("P0DT45M"), fractional hours ("PT1.5H"), and
// weeks all show up in the wild. This parses the parts we can use and ignores
// the rest rather than rejecting a whole import over a time field.
var isoDurationRe = regexp.MustCompile(
	`^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$`)

// parseISODurationMinutes converts an ISO-8601 duration to whole minutes.
// Returns nil when the value is absent, unparseable, or rounds to zero —
// "unknown" and "instant" must not collapse into the same answer.
func parseISODurationMinutes(raw string) *int {
	s := strings.ToUpper(strings.TrimSpace(raw))
	if s == "" {
		return nil
	}
	m := isoDurationRe.FindStringSubmatch(s)
	if m == nil {
		return nil
	}
	// weeks, days, hours, minutes, seconds
	perUnit := []float64{7 * 24 * 60, 24 * 60, 60, 1, 1.0 / 60}
	total := 0.0
	any := false
	for i, factor := range perUnit {
		if m[i+1] == "" {
			continue
		}
		n, err := strconv.ParseFloat(m[i+1], 64)
		if err != nil {
			return nil
		}
		total += n * factor
		any = true
	}
	if !any {
		return nil
	}
	minutes := int(total + 0.5)
	if minutes < 1 || minutes > maxTotalMinutes {
		return nil
	}
	return &minutes
}

// totalMinutesFrom picks the best available cook-time figure. totalTime is
// preferred because it is the number the filter chip means — time from starting
// to eating. Falling back to prep+cook is not merely a convenience: many sites
// publish those two and omit totalTime entirely, and a recipe with no time at
// all is invisible to the weeknight filter that BL-0020 exists to provide.
func totalMinutesFrom(totalTime, prepTime, cookTime string) *int {
	if t := parseISODurationMinutes(totalTime); t != nil {
		return t
	}
	prep := parseISODurationMinutes(prepTime)
	cook := parseISODurationMinutes(cookTime)
	if prep == nil && cook == nil {
		return nil
	}
	sum := 0
	if prep != nil {
		sum += *prep
	}
	if cook != nil {
		sum += *cook
	}
	if sum < 1 || sum > maxTotalMinutes {
		return nil
	}
	return &sum
}
