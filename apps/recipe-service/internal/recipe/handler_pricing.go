package recipe

import (
	"net/http"

	"pantry/apps/recipe-service/internal/pricing"
)

// pricingEstimate prices a set of already-aggregated grocery lines (BL-0023
// increment 1).
//
// It is a thin shim: all the logic lives in internal/pricing, which imports
// nothing from this package. The route lives here only to inherit the existing
// service-secret auth and OTel tracing rather than reimplement them — moving
// pricing to its own service later means moving that package and this handler,
// not unpicking a dependency.
func (h *handlers) pricingEstimate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Lines []pricing.Line `json:"lines"`
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
	writeJSON(w, http.StatusOK, est.Estimate(req.Lines))
}
