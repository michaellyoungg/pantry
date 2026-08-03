package pricing

import "time"

// Staleness grades how old the price table is. It is computed at request time
// from the snapshot's observation month rather than stored, so a file that sits
// in git for a year reports itself as stale without anyone editing it.
type Staleness string

const (
	// StalenessFresh is the normal state. BLS publishes Average Price data
	// monthly, roughly mid-month for the prior month, so even a snapshot
	// refreshed the day it was published is 1-2 months old. That is inherent to
	// the source, not a defect.
	StalenessFresh Staleness = "fresh" // <= 3 months
	// StalenessAging still gives a usable ballpark but is drifting.
	StalenessAging Staleness = "aging" // 4-9 months
	// StalenessStale means the UI should warn that prices may be out of date.
	StalenessStale Staleness = "stale" // > 9 months
)

const (
	freshMaxMonths = 3
	agingMaxMonths = 9
)

// stalenessAt grades an observation month against a reference time. A month in
// the future (a clock skew, or a snapshot hand-edited forward) is treated as
// fresh rather than wrapping into a negative age.
func stalenessAt(observation string, now time.Time) Staleness {
	obs, err := parseMonth(observation)
	if err != nil {
		return StalenessStale
	}
	months := monthsBetween(obs, now)
	switch {
	case months <= freshMaxMonths:
		return StalenessFresh
	case months <= agingMaxMonths:
		return StalenessAging
	default:
		return StalenessStale
	}
}

// monthsBetween counts whole calendar months from earlier to later, clamped at
// zero. Day-of-month is deliberately ignored: the source is monthly, so "June
// data on 1 August" and "June data on 31 August" are both two months old.
func monthsBetween(earlier, later time.Time) int {
	months := (later.Year()-earlier.Year())*12 + int(later.Month()) - int(earlier.Month())
	if months < 0 {
		return 0
	}
	return months
}
