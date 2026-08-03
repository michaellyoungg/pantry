package recipe

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

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
