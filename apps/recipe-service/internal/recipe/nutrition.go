package recipe

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"pantry/apps/recipe-service/internal/nutrition"
)

// The nutrition package depends on this interface, never on *Normalizer, so the
// dependency between the two packages stays one-way. This line is what proves
// the two stay compatible.
var _ nutrition.Normalizer = (*Normalizer)(nil)

// DefaultNormalizer exposes the process-wide normalizer built from
// normalization.json, so nutrition resolves units and canonical items through
// exactly the same dictionary the grocery list does.
func DefaultNormalizer() *Normalizer { return normalizer }

// Pool exposes the connection pool so the nutrition module can own its own
// queries against its own tables while sharing one pool and one schema.
func (s *PostgresStore) Pool() *pgxpool.Pool { return s.pool }

// NutritionEstimator is the slice of nutrition.Estimator the endpoint needs.
// Note the absence of an error: every failure this can have — no API key, rate
// limit reached, an ingredient nobody has data for — is a coverage fact the
// response describes, not a reason to fail the request.
type NutritionEstimator interface {
	Estimate(ctx context.Context, lines []nutrition.Line, servings float64) nutrition.Estimate
}

// RouterOption configures optional router surfaces. It is variadic on
// NewRouterWithImporter so adding one does not churn every caller.
type RouterOption func(*handlers)

// WithNutrition enables GET /recipes/{id}/nutrition. Without it the route
// answers 503, matching how import behaves when it is not configured.
func WithNutrition(est NutritionEstimator) RouterOption {
	return func(h *handlers) { h.nutrition = est }
}

func (h *handlers) recipeNutrition(w http.ResponseWriter, r *http.Request) {
	if h.nutrition == nil {
		writeError(w, r, http.StatusServiceUnavailable, "nutrition is not configured")
		return
	}
	rec, err := h.recipeForRead(r.Context(), r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "recipe not found")
		return
	}
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not load recipe", err)
		return
	}

	lines := make([]nutrition.Line, 0, len(rec.Ingredients))
	for _, ing := range rec.Ingredients {
		lines = append(lines, nutrition.Line{Quantity: ing.Quantity, Unit: ing.Unit, Item: ing.Item})
	}

	// Recipe carries no yield yet (BL-0035). 0 means "unknown", which makes
	// Compute return whole-recipe totals and omit perServing rather than divide
	// by a guess. When BL-0035 lands this becomes rec.Servings.
	const servingsUnknown = 0

	writeJSON(w, http.StatusOK, h.nutrition.Estimate(r.Context(), lines, servingsUnknown))
}

// recipeForRead resolves a recipe the caller is allowed to read: their own, or
// one from the shared catalog. Catalog recipes are owned by CatalogUserID but
// visible to everyone, and the second lookup is pinned to that owner so it can
// never reach another user's private recipes.
func (h *handlers) recipeForRead(ctx context.Context, id string) (Recipe, error) {
	rec, err := h.store.GetRecipe(ctx, id, userIDFrom(ctx))
	if errors.Is(err, ErrNotFound) {
		return h.store.GetRecipe(ctx, id, CatalogUserID)
	}
	return rec, err
}
