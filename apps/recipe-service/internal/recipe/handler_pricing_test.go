package recipe

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"pantry/apps/recipe-service/internal/pricing"
)

func postEstimate(t *testing.T, srv string, body string) pricing.Estimate {
	t.Helper()
	resp := doAuth(t, http.MethodPost, srv+"/pricing/estimate", strings.NewReader(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /pricing/estimate: status %d", resp.StatusCode)
	}
	var got pricing.Estimate
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode estimate: %v", err)
	}
	return got
}

func TestPricingEstimate(t *testing.T) {
	srv, _ := newTestServer(t)

	got := postEstimate(t, srv.URL, `{"lines":[
		{"canonicalItem":"eggs","item":"Eggs","unit":"","quantity":12},
		{"canonicalItem":"saffron","item":"Saffron","unit":"g","quantity":2}
	]}`)

	if got.Currency != "USD" {
		t.Errorf("Currency = %q, want USD", got.Currency)
	}
	if got.PricedCount != 1 || got.UnpricedCount != 1 {
		t.Errorf("priced=%d unpriced=%d, want 1/1", got.PricedCount, got.UnpricedCount)
	}
	if got.TotalCents <= 0 {
		t.Errorf("TotalCents = %d, want a positive estimate for a dozen eggs", got.TotalCents)
	}
	// The basis is what makes the number honest; it must survive the transport.
	if got.Basis.ObservationMonth == "" || got.Basis.Source == "" || got.Basis.Staleness == "" {
		t.Errorf("basis did not round-trip: %+v", got.Basis)
	}
}

func TestPricingEstimateEmptyList(t *testing.T) {
	srv, _ := newTestServer(t)
	got := postEstimate(t, srv.URL, `{"lines":[]}`)
	if got.TotalCents != 0 || got.PricedCount != 0 || got.UnpricedCount != 0 {
		t.Errorf("empty list produced %+v", got)
	}
}

func TestPricingEstimateRequiresServiceSecret(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Post(srv.URL+"/pricing/estimate", "application/json", strings.NewReader(`{"lines":[]}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Errorf("unauthenticated request succeeded; want a rejection")
	}
}

func TestPricingEstimateRejectsMalformedBody(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/pricing/estimate", strings.NewReader(`{"lines":`))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

// fakeStorePricer stands in for internal/kroger. No test in this package
// reaches a retailer: the point here is the handler's degradation contract, and
// the client's own suite covers the wire shapes against recorded fixtures.
type fakeStorePricer struct {
	quotes  map[string]pricing.StoreQuote
	stores  []pricing.StoreLocation
	err     error
	queries []pricing.StoreQuery
	seenLoc string
}

func (f *fakeStorePricer) Provider() string { return "fake-store" }

func (f *fakeStorePricer) Quote(
	_ context.Context, locationID string, queries []pricing.StoreQuery,
) (pricing.StoreQuotes, error) {
	f.seenLoc, f.queries = locationID, queries
	return pricing.StoreQuotes{
		Provider:   f.Provider(),
		LocationID: locationID,
		StoreName:  "Test Store",
		FetchedAt:  time.Date(2026, 8, 17, 12, 0, 0, 0, time.UTC),
		Quotes:     f.quotes,
	}, f.err
}

func (f *fakeStorePricer) SearchStores(
	_ context.Context, _ string, _ int,
) ([]pricing.StoreLocation, error) {
	return f.stores, f.err
}

func newStoreServer(t *testing.T, pricer StorePricer) *httptest.Server {
	t.Helper()
	opts := []RouterOption{}
	if pricer != nil {
		opts = append(opts, WithStorePricer(pricer))
	}
	srv := httptest.NewServer(NewRouterWithImporter(NewMemoryStore(), testSecret, nil, opts...))
	t.Cleanup(srv.Close)
	return srv
}

func TestPricingStoreProviderReportsTheFlag(t *testing.T) {
	t.Run("off by default", func(t *testing.T) {
		srv, _ := newTestServer(t)
		resp := doAuth(t, http.MethodGet, srv.URL+"/pricing/store-provider", nil)
		defer resp.Body.Close()
		var got pricing.StoreProviderStatus
		if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if got.Enabled || got.Provider != "" {
			t.Errorf("status = %+v, want disabled — a deployment without the flag offers no chooser", got)
		}
	})

	t.Run("on when a pricer is configured", func(t *testing.T) {
		srv := newStoreServer(t, &fakeStorePricer{})
		resp := doAuth(t, http.MethodGet, srv.URL+"/pricing/store-provider", nil)
		defer resp.Body.Close()
		var got pricing.StoreProviderStatus
		if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if !got.Enabled || got.Provider != "fake-store" {
			t.Errorf("status = %+v, want enabled for fake-store", got)
		}
	})
}

func TestPricingStoresWhenDisabled(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/pricing/stores", strings.NewReader(`{"zipCode":"45202"}`))
	defer resp.Body.Close()
	// 200 with nothing in it, not an error: "this feature is off" is an answer.
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got pricing.StoreSearch
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Provider != "" || len(got.Stores) != 0 {
		t.Errorf("search = %+v, want an empty result", got)
	}
}

func TestPricingStores(t *testing.T) {
	pricer := &fakeStorePricer{stores: []pricing.StoreLocation{
		{LocationID: "01400376", Name: "Corryville", City: "Cincinnati", State: "OH"},
	}}
	srv := newStoreServer(t, pricer)

	resp := doAuth(t, http.MethodPost, srv.URL+"/pricing/stores", strings.NewReader(`{"zipCode":"45202"}`))
	defer resp.Body.Close()
	var got pricing.StoreSearch
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Provider != "fake-store" || len(got.Stores) != 1 || got.Stores[0].LocationID != "01400376" {
		t.Errorf("search = %+v, want the one nearby store", got)
	}
}

func TestPricingStoresReportsAnUnreachableDirectory(t *testing.T) {
	srv := newStoreServer(t, &fakeStorePricer{err: errors.New("upstream down")})
	resp := doAuth(t, http.MethodPost, srv.URL+"/pricing/stores", strings.NewReader(`{"zipCode":"45202"}`))
	defer resp.Body.Close()
	// Store search has its own screen, so an empty list would read as "none
	// nearby". Pricing a list is the path that must never fail.
	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", resp.StatusCode)
	}
}

func TestPricingEstimateUsesTheChosenStore(t *testing.T) {
	pricer := &fakeStorePricer{quotes: map[string]pricing.StoreQuote{
		"eggs": {Description: "Kroger Grade A Large Eggs", Cents: 240, Dimension: pricing.DimensionCount, PackSize: 12},
	}}
	srv := newStoreServer(t, pricer)

	got := postEstimate(t, srv.URL, `{"storeLocationId":"01400376","lines":[
		{"canonicalItem":"eggs","item":"Eggs","unit":"","quantity":12}
	]}`)

	if pricer.seenLoc != "01400376" {
		t.Errorf("pricer saw locationId %q, want the one the user chose", pricer.seenLoc)
	}
	// The batch is derived from the list, so one list costs one round of lookups.
	if len(pricer.queries) != 1 || pricer.queries[0].Key != "eggs" {
		t.Errorf("queries = %+v, want one lookup keyed on the normalized item", pricer.queries)
	}
	if got.TotalCents != 240 {
		t.Errorf("totalCents = %d, want the shelf price of 240", got.TotalCents)
	}
	if got.Lines[0].Source != pricing.SourceStore {
		t.Errorf("source = %q, want %q", got.Lines[0].Source, pricing.SourceStore)
	}
	if got.Basis.Store == nil || got.Basis.Store.LocationID != "01400376" {
		t.Errorf("basis.store = %+v, want the store provenance", got.Basis.Store)
	}
}

func TestPricingEstimateIgnoresTheStoreWhenTheFlagIsOff(t *testing.T) {
	srv, _ := newTestServer(t)
	// A stored selection outlives the flag being turned off. It must be inert,
	// not an error.
	got := postEstimate(t, srv.URL, `{"storeLocationId":"01400376","lines":[
		{"canonicalItem":"eggs","item":"Eggs","unit":"","quantity":12}
	]}`)
	if got.Basis.Store != nil {
		t.Errorf("basis.store = %+v, want none with the feature off", got.Basis.Store)
	}
	if got.PricedCount != 1 || got.TotalCents <= 0 {
		t.Errorf("estimate = %+v, want the BLS estimate unchanged", got)
	}
	if got.Lines[0].Source != pricing.SourceAverage {
		t.Errorf("source = %q, want %q", got.Lines[0].Source, pricing.SourceAverage)
	}
}

func TestPricingEstimateSurvivesAnUnreachableStore(t *testing.T) {
	srv := newStoreServer(t, &fakeStorePricer{err: errors.New("retailer unreachable")})

	// The whole non-negotiable, end to end: an external API being down costs the
	// upgrade, never the estimate.
	got := postEstimate(t, srv.URL, `{"storeLocationId":"01400376","lines":[
		{"canonicalItem":"eggs","item":"Eggs","unit":"","quantity":12}
	]}`)
	if got.PricedCount != 1 || got.TotalCents <= 0 {
		t.Errorf("estimate = %+v, want the BLS estimate to stand", got)
	}
	if got.Basis.Store != nil {
		t.Errorf("basis.store = %+v, want none — nothing was priced from the shelf", got.Basis.Store)
	}
}

func TestPricingEstimateWithoutAStoreDoesNotCallOne(t *testing.T) {
	pricer := &fakeStorePricer{}
	srv := newStoreServer(t, pricer)

	postEstimate(t, srv.URL, `{"lines":[{"canonicalItem":"eggs","item":"Eggs","unit":"","quantity":12}]}`)
	// No store selected is the default for every user, and it must not spend a
	// call on the retailer's budget.
	if pricer.seenLoc != "" {
		t.Errorf("pricer was called with %q for a user who never opted in", pricer.seenLoc)
	}
}

func TestPricingEstimateIgnoresAStoreFromAnotherProvider(t *testing.T) {
	pricer := &fakeStorePricer{quotes: map[string]pricing.StoreQuote{
		"eggs": {Description: "Not our eggs", Cents: 240, Dimension: pricing.DimensionCount, PackSize: 12},
	}}
	srv := newStoreServer(t, pricer)

	// A selection made when the deployment priced against a different retailer.
	// The same location id means something else there, so it must not be priced.
	got := postEstimate(t, srv.URL, `{"storeLocationId":"01400376","storeProvider":"other-store","lines":[
		{"canonicalItem":"eggs","item":"Eggs","unit":"","quantity":12}
	]}`)
	if pricer.seenLoc != "" {
		t.Errorf("pricer was called with a foreign provider's location %q", pricer.seenLoc)
	}
	if got.Basis.Store != nil || got.Lines[0].Source != pricing.SourceAverage {
		t.Errorf("estimate = %+v, want the averages", got)
	}
}
