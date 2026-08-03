package pricing

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestStalenessBoundaries(t *testing.T) {
	obs := "2026-06"
	cases := []struct {
		at   time.Time
		want Staleness
	}{
		// BLS publishes monthly in arrears, so even a perfectly maintained
		// snapshot is normally 1-2 months old.
		{time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC), StalenessFresh},
		{time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), StalenessFresh},  // 3 months
		{time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), StalenessAging}, // 4
		{time.Date(2027, 3, 1, 0, 0, 0, 0, time.UTC), StalenessAging},  // 9
		{time.Date(2027, 4, 1, 0, 0, 0, 0, time.UTC), StalenessStale},  // 10
		// Day-of-month is irrelevant: the source is monthly.
		{time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC), StalenessFresh},
		{time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC), StalenessFresh},
		// A clock skew must not wrap into a negative age.
		{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), StalenessFresh},
	}
	for _, c := range cases {
		if got := stalenessAt(obs, c.at); got != c.want {
			t.Errorf("stalenessAt(%q, %s) = %q, want %q", obs, c.at.Format("2006-01"), got, c.want)
		}
	}
	if got := stalenessAt("nonsense", time.Now()); got != StalenessStale {
		t.Errorf("unparseable month = %q, want stale", got)
	}
}

// The embedded data is what ships, so exercise it directly rather than only
// through fixtures.
func TestDefaultEstimatorLoads(t *testing.T) {
	e, err := Default()
	if err != nil {
		t.Fatalf("Default: %v", err)
	}
	if len(e.Snapshot().Series) == 0 {
		t.Fatal("embedded snapshot has no series")
	}
}

// Every bucket must point at a series that actually exists, or the ingredients
// mapped to it silently go unpriced with no signal in the data files.
func TestMappingSeriesExist(t *testing.T) {
	e, err := Default()
	if err != nil {
		t.Fatalf("Default: %v", err)
	}
	snap := e.Snapshot()
	m, err := EmbeddedMapping()
	if err != nil {
		t.Fatalf("EmbeddedMapping: %v", err)
	}
	for key, b := range m.Buckets {
		if _, ok := snap.Series[b.SeriesID]; !ok {
			t.Errorf("bucket %q references series %s, which is not in the snapshot", key, b.SeriesID)
		}
		if b.Label == "" {
			t.Errorf("bucket %q has no label", key)
		}
	}
}

// Conversely, a series in the snapshot that no bucket references is dead weight
// the refresher keeps fetching.
func TestSnapshotHasNoUnreferencedSeries(t *testing.T) {
	e, err := Default()
	if err != nil {
		t.Fatalf("Default: %v", err)
	}
	m, err := EmbeddedMapping()
	if err != nil {
		t.Fatalf("EmbeddedMapping: %v", err)
	}
	used := map[string]bool{}
	for _, b := range m.Buckets {
		used[b.SeriesID] = true
	}
	for id := range e.Snapshot().Series {
		if !used[id] {
			t.Errorf("series %s is in the snapshot but no bucket references it", id)
		}
	}
}

// Spot-check the shipped data end to end. Bounds are wide enough to survive
// normal price movement but tight enough to catch a pack-size or unit blunder —
// the failure mode where a 453 g pound is read as 1 g and every beef line is
// off by 453x.
func TestEmbeddedPricesAreInSaneRanges(t *testing.T) {
	e, err := Default()
	if err != nil {
		t.Fatalf("Default: %v", err)
	}
	cases := []struct {
		name               string
		line               Line
		minCents, maxCents int
	}{
		{"a dozen eggs", Line{CanonicalItem: "eggs", Unit: "", Quantity: 12}, 100, 900},
		{"a gallon of milk", Line{CanonicalItem: "milk", Unit: "l", Quantity: 3.785}, 200, 900},
		{"a pound of ground beef", Line{CanonicalItem: "ground beef", Unit: "lb", Quantity: 1}, 300, 1200},
		{"a pound of chicken breast", Line{CanonicalItem: "chicken breast", Unit: "lb", Quantity: 1}, 150, 900},
		{"a pound of flour", Line{CanonicalItem: "flour", Unit: "lb", Quantity: 1}, 20, 200},
		{"a stick of butter (113 g)", Line{CanonicalItem: "butter", Unit: "g", Quantity: 113}, 40, 300},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := e.Estimate([]Line{c.line})
			if got.PricedCount != 1 {
				t.Fatalf("unpriced: %s", got.Lines[0].Reason)
			}
			if got.TotalCents < c.minCents || got.TotalCents > c.maxCents {
				t.Errorf("%s = %d cents, want between %d and %d",
					c.name, got.TotalCents, c.minCents, c.maxCents)
			}
		})
	}
}

// internal/pricing keeps its own unit table so it never imports internal/recipe
// (see units.go). This is the guard that stops the two from drifting apart and
// pricing a cup as a different volume than the aggregator summed it as.
func TestUnitFactorsMatchNormalization(t *testing.T) {
	raw, err := os.ReadFile("../recipe/normalization.json")
	if err != nil {
		t.Fatalf("read normalization.json: %v", err)
	}
	var norm struct {
		Units map[string]struct {
			Dimension string  `json:"dimension"`
			ToBase    float64 `json:"toBase"`
		} `json:"units"`
	}
	if err := json.Unmarshal(raw, &norm); err != nil {
		t.Fatalf("parse normalization.json: %v", err)
	}

	shared := 0
	for name, u := range norm.Units {
		ours, ok := unitFactors[name]
		if !ok {
			t.Errorf("normalization.json declares unit %q, which pricing does not know", name)
			continue
		}
		shared++
		if string(ours.dimension) != u.Dimension {
			t.Errorf("unit %q: pricing dimension %q, normalization %q", name, ours.dimension, u.Dimension)
		}
		if ours.toBase != u.ToBase {
			t.Errorf("unit %q: pricing toBase %v, normalization %v", name, ours.toBase, u.ToBase)
		}
	}
	if shared == 0 {
		t.Fatal("compared no units — the guard is not actually checking anything")
	}
}
