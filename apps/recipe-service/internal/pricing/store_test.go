package pricing

import (
	"testing"
	"time"
)

var testNow = time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC)

// storeQuotes wraps a bucket-keyed quote set with the provenance a real pricer
// would attach.
func storeQuotes(quotes map[string]StoreQuote) StoreQuotes {
	return StoreQuotes{
		Provider:   "kroger",
		LocationID: "01400376",
		StoreName:  "Corryville",
		FetchedAt:  testNow,
		Quotes:     quotes,
	}
}

func TestEstimateWithStorePrefersTheShelfPrice(t *testing.T) {
	e := mustEstimator(t)
	// $10.00 per 1000 g from the averages; the store sells 500 g for $2.00,
	// which is 0.4c/g against the averages' 1c/g.
	got := e.estimateWithStoreAt(
		[]Line{{CanonicalItem: "beef", Item: "beef", Unit: "g", Quantity: 250}},
		storeQuotes(map[string]StoreQuote{
			"beef": {Description: "Kroger Ground Beef", Cents: 200, Dimension: DimensionMass, PackSize: 500},
		}),
		testNow,
	)

	if got.TotalCents != 100 {
		t.Errorf("totalCents = %d, want 100 (250 g at 0.4c/g)", got.TotalCents)
	}
	line := got.Lines[0]
	if line.Source != SourceStore {
		t.Errorf("source = %q, want %q", line.Source, SourceStore)
	}
	if line.Product != "Kroger Ground Beef" {
		t.Errorf("product = %q, want the shelf item that was priced", line.Product)
	}
	// The bucket still resolves, because the averages remain the fallback for
	// every other line and the label is what the UI groups by.
	if line.Bucket != "beef" {
		t.Errorf("bucket = %q, want it kept alongside the store price", line.Bucket)
	}
}

func TestEstimateWithStoreFallsBackPerLine(t *testing.T) {
	e := mustEstimator(t)
	got := e.estimateWithStoreAt(
		[]Line{
			{CanonicalItem: "beef", Item: "beef", Unit: "g", Quantity: 250},
			{CanonicalItem: "milk", Item: "milk", Unit: "ml", Quantity: 500},
		},
		storeQuotes(map[string]StoreQuote{
			"beef": {Description: "Kroger Ground Beef", Cents: 200, Dimension: DimensionMass, PackSize: 500},
		}),
		testNow,
	)

	// The store priced the beef; the milk keeps the national average (0.2c/ml).
	if got.TotalCents != 200 {
		t.Errorf("totalCents = %d, want 200 (100 store + 100 average)", got.TotalCents)
	}
	if got.Lines[0].Source != SourceStore || got.Lines[1].Source != SourceAverage {
		t.Errorf("sources = %q/%q, want store/average", got.Lines[0].Source, got.Lines[1].Source)
	}
	if got.PricedCount != 2 || got.UnpricedCount != 0 {
		t.Errorf("priced/unpriced = %d/%d, want 2/0 — a mixed list must have no holes",
			got.PricedCount, got.UnpricedCount)
	}
	if got.Basis.Store == nil {
		t.Fatal("basis.store is nil, want the store provenance")
	}
	if got.Basis.Store.PricedCount != 1 {
		t.Errorf("store.pricedCount = %d, want 1 — the rest came from the averages",
			got.Basis.Store.PricedCount)
	}
	if got.Basis.Store.FetchedAt != "2026-08-17T12:00:00Z" {
		t.Errorf("store.fetchedAt = %q, want the quote time in RFC 3339", got.Basis.Store.FetchedAt)
	}
	// The averages basis is still there: a mixed estimate has two sources and
	// showing only one of them would overstate the total's precision.
	if got.Basis.Source != "test source" {
		t.Errorf("basis.source = %q, want the averages basis kept", got.Basis.Source)
	}
}

func TestEstimateWithStoreMatchesEstimateWhenTheStoreAnswersNothing(t *testing.T) {
	e := mustEstimator(t)
	lines := []Line{
		{CanonicalItem: "beef", Item: "beef", Unit: "g", Quantity: 250},
		{CanonicalItem: "sumac", Item: "sumac", Unit: "tsp", Quantity: 2},
	}
	// An unreachable retailer, a store that carries nothing, and a user who
	// never opted in all arrive here as an empty quote set.
	withStore := e.estimateWithStoreAt(lines, storeQuotes(map[string]StoreQuote{}), testNow)
	plain := e.estimateAt(lines, testNow)

	if withStore.TotalCents != plain.TotalCents || withStore.PricedCount != plain.PricedCount {
		t.Errorf("degraded estimate = %+v, want the averages-only estimate %+v", withStore, plain)
	}
	if withStore.Basis.Store != nil {
		t.Error("basis.store is set though the store priced nothing — a false attribution")
	}
	for i, line := range withStore.Lines {
		if line.Source != plain.Lines[i].Source {
			t.Errorf("line %d source = %q, want %q", i, line.Source, plain.Lines[i].Source)
		}
	}
}

func TestEstimateWithStorePricesWhatTheAveragesCannot(t *testing.T) {
	e := mustEstimator(t)
	// "sumac" maps to no BLS bucket, so the averages report it unpriced. A store
	// that stocks it can price it anyway, which is part of what opting in buys.
	got := e.estimateWithStoreAt(
		[]Line{{CanonicalItem: "sumac", Item: "sumac", Unit: "g", Quantity: 20}},
		storeQuotes(map[string]StoreQuote{
			"sumac": {Description: "Spice Islands Sumac", Cents: 400, Dimension: DimensionMass, PackSize: 40},
		}),
		testNow,
	)
	if got.PricedCount != 1 || got.TotalCents != 200 {
		t.Errorf("estimate = %d priced / %dc, want 1 / 200c", got.PricedCount, got.TotalCents)
	}
	if got.Lines[0].Bucket != "" {
		t.Errorf("bucket = %q, want empty — there is no averages bucket to name", got.Lines[0].Bucket)
	}
}

func TestEstimateWithStoreFallsBackWhenTheUnitCannotConvert(t *testing.T) {
	e := mustEstimator(t)
	// A count of bacon against a mass-quoted pack, with no per-item weight to
	// bridge them. Guessing is worse than the average, so the average wins.
	got := e.estimateWithStoreAt(
		[]Line{{CanonicalItem: "bacon", Item: "bacon", Unit: "", Quantity: 3}},
		storeQuotes(map[string]StoreQuote{
			"bacon": {Description: "Kroger Bacon", Cents: 599, Dimension: DimensionMass, PackSize: 454},
		}),
		testNow,
	)
	if got.Lines[0].Priced {
		t.Errorf("line = %+v, want unpriced with the averages' reason", got.Lines[0])
	}
	if got.Lines[0].Reason != ReasonUnitMismatch {
		t.Errorf("reason = %q, want %q", got.Lines[0].Reason, ReasonUnitMismatch)
	}
	if got.Basis.Store != nil {
		t.Error("basis.store is set though nothing was priced from the shelf")
	}
}

func TestEstimateWithStoreIgnoresUnusableQuotes(t *testing.T) {
	e := mustEstimator(t)
	cases := map[string]StoreQuote{
		"zero pack size": {Cents: 200, Dimension: DimensionMass, PackSize: 0},
		"zero price":     {Cents: 0, Dimension: DimensionMass, PackSize: 500},
		"negative price": {Cents: -100, Dimension: DimensionMass, PackSize: 500},
	}
	for name, quote := range cases {
		t.Run(name, func(t *testing.T) {
			got := e.estimateWithStoreAt(
				[]Line{{CanonicalItem: "beef", Item: "beef", Unit: "g", Quantity: 250}},
				storeQuotes(map[string]StoreQuote{"beef": quote}),
				testNow,
			)
			if got.Lines[0].Source != SourceAverage {
				t.Errorf("source = %q, want the averages", got.Lines[0].Source)
			}
			if got.TotalCents != 250 {
				t.Errorf("totalCents = %d, want the averages' 250", got.TotalCents)
			}
		})
	}
}

func TestEstimateWithStoreCarriesTheSaleFlag(t *testing.T) {
	e := mustEstimator(t)
	got := e.estimateWithStoreAt(
		[]Line{{CanonicalItem: "beef", Item: "beef", Unit: "g", Quantity: 500}},
		storeQuotes(map[string]StoreQuote{
			"beef": {Description: "Kroger Ground Beef", Cents: 200, Dimension: DimensionMass, PackSize: 500, OnSale: true},
		}),
		testNow,
	)
	if !got.Lines[0].OnSale {
		t.Error("onSale = false, want true — a promotional price will not last")
	}
}

func TestStoreQueries(t *testing.T) {
	e := mustEstimator(t)
	got := e.StoreQueries([]Line{
		{CanonicalItem: "milk", Item: "whole milk", Unit: "ml", Quantity: 500},
		// Same identity from a second recipe: one lookup, not two. This is what
		// keeps a long list inside a daily call budget.
		{CanonicalItem: "milk", Item: "milk", Unit: "cup", Quantity: 1},
		{CanonicalItem: "beef", Item: "ground beef", Unit: "g", Quantity: 250},
		// No quantity to price, and no identity to look up.
		{CanonicalItem: "flour", Item: "flour", Unit: "g", Quantity: 0},
		{CanonicalItem: "", Item: "", Unit: "g", Quantity: 5},
		// Pre-normalization rows have only display text.
		{CanonicalItem: "", Item: "Bacon", Unit: "g", Quantity: 100},
	})

	want := []StoreQuery{
		{Key: "Bacon", Term: "Bacon"},
		{Key: "beef", Term: "ground beef"},
		{Key: "milk", Term: "whole milk"},
	}
	if len(got) != len(want) {
		t.Fatalf("queries = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("query %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}
