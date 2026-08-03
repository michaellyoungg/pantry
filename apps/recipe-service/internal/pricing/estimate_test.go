package pricing

import (
	"testing"
	"time"
)

// testSnapshot uses round numbers so expected cents are obvious by hand:
// $10.00 per 1000 g = 1c/g, $2.00 per 1000 ml = 0.2c/ml, $6.00 per dozen = 50c each.
func testSnapshot() Snapshot {
	return Snapshot{
		Source:           "test source",
		SourceURL:        "https://example.test",
		Area:             "U.S. city average",
		ObservationMonth: "2026-06",
		FetchedAt:        "2026-07-01",
		Series: map[string]Series{
			"S-MASS":   {Title: "Mass thing", Value: 10, Month: "2026-06", Dimension: DimensionMass, PackSize: 1000},
			"S-VOLUME": {Title: "Volume thing", Value: 2, Month: "2026-06", Dimension: DimensionVolume, PackSize: 1000},
			"S-COUNT":  {Title: "Counted thing", Value: 6, Month: "2026-06", Dimension: DimensionCount, PackSize: 12},
		},
	}
}

func testEstimatorMapping() MappingFile {
	return MappingFile{Buckets: map[string]Bucket{
		"beef":  {SeriesID: "S-MASS", Label: "Beef", Match: []string{"beef"}},
		"milk":  {SeriesID: "S-VOLUME", Label: "Milk", Match: []string{"milk"}},
		"eggs":  {SeriesID: "S-COUNT", Label: "Eggs", Match: []string{"egg"}, GramsEach: 50},
		"flour": {SeriesID: "S-MASS", Label: "Flour", Match: []string{"flour"}, GramsPerMl: 0.5},
		// Mapped to a series the snapshot does not contain.
		"orphan": {SeriesID: "S-MISSING", Label: "Orphan", Match: []string{"orphan"}},
		// A mass bucket with no bridges: a counted line cannot reach it.
		"bacon": {SeriesID: "S-MASS", Label: "Bacon", Match: []string{"bacon"}},
	}}
}

func mustEstimator(t *testing.T) *Estimator {
	t.Helper()
	e, err := NewEstimator(testSnapshot(), testEstimatorMapping())
	if err != nil {
		t.Fatalf("NewEstimator: %v", err)
	}
	return e
}

func TestEstimateDimensionPaths(t *testing.T) {
	e := mustEstimator(t)
	cases := []struct {
		name      string
		line      Line
		wantCents int
	}{
		{"mass direct, grams", Line{CanonicalItem: "beef", Unit: "g", Quantity: 500}, 500},
		{"mass direct, pounds", Line{CanonicalItem: "beef", Unit: "lb", Quantity: 1}, 454},
		{"volume direct, ml", Line{CanonicalItem: "milk", Unit: "ml", Quantity: 500}, 100},
		{"volume direct, cups", Line{CanonicalItem: "milk", Unit: "cup", Quantity: 2}, 95},
		{"count direct", Line{CanonicalItem: "egg", Unit: "", Quantity: 3}, 150},
		{"count with a non-convertible unit", Line{CanonicalItem: "egg", Unit: "whole", Quantity: 2}, 100},
		// 2 cups = 473.176 ml, at 0.5 g/ml = 236.588 g, at 1c/g.
		{"volume bridged to mass by density", Line{CanonicalItem: "flour", Unit: "cup", Quantity: 2}, 237},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := e.Estimate([]Line{c.line})
			if got.UnpricedCount != 0 {
				t.Fatalf("line was unpriced: %s", got.Lines[0].Reason)
			}
			if got.TotalCents != c.wantCents {
				t.Errorf("TotalCents = %d, want %d", got.TotalCents, c.wantCents)
			}
		})
	}
}

func TestEstimateUnpricedReasons(t *testing.T) {
	e := mustEstimator(t)
	cases := []struct {
		name       string
		line       Line
		wantReason string
	}{
		{"no bucket", Line{CanonicalItem: "saffron", Unit: "g", Quantity: 5}, ReasonNoMatch},
		{"series missing from snapshot", Line{CanonicalItem: "orphan", Unit: "g", Quantity: 5}, ReasonNoSeries},
		// A counted line cannot reach a mass series without a declared gramsEach:
		// "2 bacon" has no honest weight.
		{"count into mass with no bridge", Line{CanonicalItem: "bacon", Unit: "", Quantity: 2}, ReasonUnitMismatch},
		// And a measured quantity is not a count: 200 g of egg is not an egg.
		{"mass into count", Line{CanonicalItem: "egg", Unit: "g", Quantity: 200}, ReasonUnitMismatch},
		// Volume into mass with no declared density stays unpriced rather than guessed.
		{"volume into mass with no density", Line{CanonicalItem: "beef", Unit: "cup", Quantity: 1}, ReasonUnitMismatch},
		{"non-positive quantity", Line{CanonicalItem: "beef", Unit: "g", Quantity: 0}, ReasonBadQuantity},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := e.Estimate([]Line{c.line})
			if got.PricedCount != 0 || got.UnpricedCount != 1 {
				t.Fatalf("priced=%d unpriced=%d, want 0/1", got.PricedCount, got.UnpricedCount)
			}
			if got.TotalCents != 0 {
				t.Errorf("TotalCents = %d, want 0 for an unpriced line", got.TotalCents)
			}
			if got.Lines[0].Reason != c.wantReason {
				t.Errorf("Reason = %q, want %q", got.Lines[0].Reason, c.wantReason)
			}
		})
	}
}

func TestEstimateTotalsAndCounts(t *testing.T) {
	e := mustEstimator(t)
	got := e.Estimate([]Line{
		{CanonicalItem: "beef", Unit: "g", Quantity: 500},  // 500c
		{CanonicalItem: "milk", Unit: "ml", Quantity: 500}, // 100c
		{CanonicalItem: "saffron", Unit: "g", Quantity: 1}, // unpriced
	})
	if got.TotalCents != 600 {
		t.Errorf("TotalCents = %d, want 600", got.TotalCents)
	}
	if got.PricedCount != 2 || got.UnpricedCount != 1 {
		t.Errorf("priced=%d unpriced=%d, want 2/1", got.PricedCount, got.UnpricedCount)
	}
	if got.Currency != "USD" {
		t.Errorf("Currency = %q, want USD", got.Currency)
	}

	// The per-line cents must add up to the displayed total, or the itemisation
	// contradicts the headline number.
	sum := 0
	for _, l := range got.Lines {
		sum += l.Cents
	}
	if sum != got.TotalCents {
		t.Errorf("line cents sum to %d, total is %d", sum, got.TotalCents)
	}
}

func TestEstimateEmptyList(t *testing.T) {
	got := mustEstimator(t).Estimate(nil)
	if got.TotalCents != 0 || got.PricedCount != 0 || got.UnpricedCount != 0 {
		t.Errorf("empty list produced %+v", got)
	}
	if got.Basis.ObservationMonth != "2026-06" {
		t.Errorf("basis lost on an empty list: %+v", got.Basis)
	}
}

// Rows written before normalization existed carry no canonicalItem; the display
// text is the only identity available and must still be tried.
func TestEstimateFallsBackToDisplayText(t *testing.T) {
	got := mustEstimator(t).Estimate([]Line{{Item: "Ground Beef", Unit: "g", Quantity: 500}})
	if got.PricedCount != 1 {
		t.Fatalf("unpriced: %s", got.Lines[0].Reason)
	}
	if got.TotalCents != 500 {
		t.Errorf("TotalCents = %d, want 500", got.TotalCents)
	}
}

func TestEstimateCarriesBasis(t *testing.T) {
	e := mustEstimator(t)
	// Two months after the observation month: still fresh.
	at := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	got := e.estimateAt([]Line{{CanonicalItem: "beef", Unit: "g", Quantity: 1}}, at)
	if got.Basis.Source != "test source" || got.Basis.Area != "U.S. city average" {
		t.Errorf("basis = %+v", got.Basis)
	}
	if got.Basis.Staleness != StalenessFresh {
		t.Errorf("Staleness = %q, want fresh", got.Basis.Staleness)
	}
}

func TestNewEstimatorRejectsInvalidSnapshots(t *testing.T) {
	cases := map[string]func(*Snapshot){
		"no observation month": func(s *Snapshot) { s.ObservationMonth = "" },
		"bad observation month": func(s *Snapshot) {
			s.ObservationMonth = "June 2026"
		},
		"no series": func(s *Snapshot) { s.Series = map[string]Series{} },
		"zero value": func(s *Snapshot) {
			s.Series["S-MASS"] = Series{Dimension: DimensionMass, PackSize: 1, Month: "2026-06"}
		},
		"zero pack size": func(s *Snapshot) { s.Series["S-MASS"] = Series{Dimension: DimensionMass, Value: 1, Month: "2026-06"} },
		"unknown dimension": func(s *Snapshot) {
			s.Series["S-MASS"] = Series{Dimension: "weight", Value: 1, PackSize: 1, Month: "2026-06"}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			s := testSnapshot()
			mutate(&s)
			if _, err := NewEstimator(s, testEstimatorMapping()); err == nil {
				t.Fatal("want error, got nil")
			}
		})
	}
}
