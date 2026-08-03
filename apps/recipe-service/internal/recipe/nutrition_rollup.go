package recipe

import (
	"context"
	"log/slog"
	"net/http"

	"pantry/apps/recipe-service/internal/nutrition"
)

// POST /nutrition/estimate — the plan rollup (BL-0037).
//
// The request is deliberately the same `{items: [{recipeId, multiplier}]}` shape
// the grocery list already takes, and the scaling runs through the same
// ScaledRecipe. A plan that is shopped for at one scale and counted at another
// would be worse than no numbers at all, so there is one multiplier rule
// (ScaledRecipe.Scale) and both paths read it.
//
// Whether a leftover belongs in the request is the *caller's* call and the two
// paths answer it oppositely: a leftover adds nothing to the grocery list but is
// still food that gets eaten, so Convex includes it here and excludes it there.
// This handler counts whatever it is given.

func (h *handlers) nutritionEstimate(w http.ResponseWriter, r *http.Request) {
	if h.nutrition == nil {
		writeError(w, r, http.StatusServiceUnavailable, "nutrition is not configured")
		return
	}
	var req struct {
		Items []struct {
			RecipeID   string  `json:"recipeId"`
			Multiplier float64 `json:"multiplier"`
		} `json:"items"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	ids := make([]string, 0, len(req.Items))
	for _, it := range req.Items {
		ids = append(ids, it.RecipeID)
	}
	byID, err := h.readableRecipes(r.Context(), ids)
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not load recipes", err)
		return
	}

	groups := make([]nutrition.Group, 0, len(req.Items))
	// covers is built in request order and indexed alongside groups, so the
	// per-group coverage the estimator returns can be zipped straight back onto
	// the recipe it came from.
	covers := make([]nutrition.RecipeCoverage, 0, len(req.Items))
	uncounted := make([]string, 0)

	for _, it := range req.Items {
		rec, ok := byID[it.RecipeID]
		entry := ScaledRecipe{Recipe: rec, Multiplier: it.Multiplier}
		cov := nutrition.RecipeCoverage{
			RecipeID:   it.RecipeID,
			Title:      rec.Title,
			Multiplier: entry.Scale(),
			Counted:    ok,
		}
		if !ok {
			// A basket can outlive the recipe it points at. Dropping the entry
			// silently would leave the day's total looking complete while a whole
			// dinner is missing from it — so it travels in the response as an
			// uncounted recipe instead.
			uncounted = append(uncounted, it.RecipeID)
			covers = append(covers, cov)
			continue
		}
		groups = append(groups, nutrition.Group{ID: it.RecipeID, Lines: scaledLines(entry)})
		covers = append(covers, cov)
	}
	if len(uncounted) > 0 {
		slog.WarnContext(r.Context(), "nutrition-rollup: unresolvable recipe ids",
			"count", len(uncounted), "ids", uncounted)
	}

	est, groupCovs := h.nutrition.EstimateGroups(r.Context(), groups)

	byRecipe := make(map[string]nutrition.Coverage, len(groupCovs))
	for _, gc := range groupCovs {
		byRecipe[gc.ID] = gc.Coverage
	}
	for i := range covers {
		if covers[i].Counted {
			covers[i].Coverage = byRecipe[covers[i].RecipeID]
		}
	}
	est.Recipes = covers

	writeJSON(w, http.StatusOK, est)
}

// scaledLines is the recipe's ingredient lines at its servings multiplier — the
// nutrition-side twin of what AggregateScaled does before summing groceries.
func scaledLines(e ScaledRecipe) []nutrition.Line {
	mult := e.Scale()
	lines := make([]nutrition.Line, 0, len(e.Recipe.Ingredients))
	for _, ing := range e.Recipe.Ingredients {
		lines = append(lines, nutrition.Line{
			Quantity: ing.Quantity * mult,
			Unit:     ing.Unit,
			Item:     ing.Item,
		})
	}
	return lines
}

// readableRecipes loads the recipes the caller may read, keyed by id: their own
// first, then the shared catalog for whatever the user-scoped lookup missed.
// Catalog recipes are owned by CatalogUserID but visible to everyone, and the
// second lookup is pinned to that owner so it can never reach another user's
// private recipes. Ids that resolve to neither are simply absent from the map —
// each caller decides what a missing recipe means for it.
func (h *handlers) readableRecipes(ctx context.Context, ids []string) (map[string]Recipe, error) {
	unique := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}

	recs, err := h.store.GetRecipesByIDs(ctx, userIDFrom(ctx), unique)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]Recipe, len(recs))
	for _, rec := range recs {
		byID[rec.ID] = rec
	}

	missing := make([]string, 0, len(unique))
	for _, id := range unique {
		if _, ok := byID[id]; !ok {
			missing = append(missing, id)
		}
	}
	if len(missing) == 0 {
		return byID, nil
	}
	catRecs, err := h.store.GetRecipesByIDs(ctx, CatalogUserID, missing)
	if err != nil {
		return nil, err
	}
	for _, rec := range catRecs {
		byID[rec.ID] = rec
	}
	return byID, nil
}
