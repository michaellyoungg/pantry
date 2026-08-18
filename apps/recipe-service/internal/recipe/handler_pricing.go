package recipe

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"pantry/apps/recipe-service/internal/pricing"
)

// pricing endpoints (BL-0023 increment 1, BL-0046 increment 2).
//
// These are thin shims: all the logic lives in internal/pricing, which imports
// nothing from this package. The routes live here only to inherit the existing
// service-secret auth and OTel tracing rather than reimplement them — moving
// pricing to its own service later means moving that package and these
// handlers, not unpicking a dependency.

// storeQuoteTimeout bounds the whole store-lookup step. Real prices are an
// upgrade on an estimate the service can already produce offline, so they get a
// slice of the request budget and no more; whatever has not arrived by then
// falls back to the national averages.
const storeQuoteTimeout = 8 * time.Second

// StorePricer is the slice of pricing.StorePricer the endpoints need. It is
// nil unless WithStorePricer was passed, which is the default: real store
// prices are off until an operator both sets the feature flag and supplies
// credentials.
type StorePricer interface {
	Provider() string
	Quote(ctx context.Context, locationID string, queries []pricing.StoreQuery) (pricing.StoreQuotes, error)
	SearchStores(ctx context.Context, zipCode string, radiusMiles int) ([]pricing.StoreLocation, error)
}

// WithStorePricer enables real store prices: POST /pricing/stores starts
// answering with stores, GET /pricing/store-provider starts reporting enabled,
// and POST /pricing/estimate honours storeLocationId. Without it every one of
// those degrades to the BLS estimate rather than failing.
func WithStorePricer(p StorePricer) RouterOption {
	return func(h *handlers) { h.storePricer = p }
}

func (h *handlers) pricingEstimate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Lines []pricing.Line `json:"lines"`
		// StoreLocationID is the store the user opted into. Empty — which is
		// every user who has not chosen one — means the averages alone.
		StoreLocationID string `json:"storeLocationId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	est, err := pricing.Default()
	if err != nil {
		// A malformed embedded price table is a deploy-time bug, not a client
		// error. The caller degrades to showing no estimate.
		writeErr(w, r, http.StatusInternalServerError, "pricing data is unavailable", err)
		return
	}

	if h.storePricer != nil && req.StoreLocationID != "" {
		writeJSON(w, http.StatusOK, est.EstimateWithStore(req.Lines, h.storeQuotes(r, est, req.Lines, req.StoreLocationID)))
		return
	}
	writeJSON(w, http.StatusOK, est.Estimate(req.Lines))
}

// storeQuotes fetches shelf prices, and returns an empty set on any failure.
// This is the whole graceful-degradation contract in one place: the caller
// cannot tell an unreachable retailer from a store that carries nothing, and
// neither can break the grocery list.
func (h *handlers) storeQuotes(
	r *http.Request, est *pricing.Estimator, lines []pricing.Line, locationID string,
) pricing.StoreQuotes {
	ctx, cancel := context.WithTimeout(r.Context(), storeQuoteTimeout)
	defer cancel()

	quotes, err := h.storePricer.Quote(ctx, locationID, est.StoreQueries(lines))
	if err != nil {
		slog.WarnContext(ctx, "pricing: store lookup failed; falling back to averages",
			"provider", h.storePricer.Provider(), "err", err)
	}
	return quotes
}

// pricingStoreProvider reports whether real store prices are configured, so a
// client can hide the store chooser instead of offering a control that cannot
// work. This is the feature flag as seen from outside the service, and it makes
// no upstream call.
func (h *handlers) pricingStoreProvider(w http.ResponseWriter, r *http.Request) {
	status := pricing.StoreProviderStatus{}
	if h.storePricer != nil {
		status = pricing.StoreProviderStatus{Enabled: true, Provider: h.storePricer.Provider()}
	}
	writeJSON(w, http.StatusOK, status)
}

func (h *handlers) pricingStores(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ZipCode     string `json:"zipCode"`
		RadiusMiles int    `json:"radiusMiles"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if h.storePricer == nil {
		// 200 with no provider, not 503: "this feature is off" is an answer, and
		// the client renders it by showing nothing at all.
		writeJSON(w, http.StatusOK, pricing.StoreSearch{Stores: []pricing.StoreLocation{}})
		return
	}
	stores, err := h.storePricer.SearchStores(r.Context(), req.ZipCode, req.RadiusMiles)
	if err != nil {
		// Unlike pricing a list, this answers a deliberate user action with its
		// own screen, where "we could not reach the store list" is the honest
		// thing to say rather than an empty result that reads as "none nearby".
		writeErr(w, r, http.StatusBadGateway, "could not reach the store directory", err)
		return
	}
	if stores == nil {
		stores = []pricing.StoreLocation{}
	}
	writeJSON(w, http.StatusOK, pricing.StoreSearch{Provider: h.storePricer.Provider(), Stores: stores})
}
