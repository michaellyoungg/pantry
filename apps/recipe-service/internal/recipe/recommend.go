package recipe

import (
	"context"
	"net/http"

	"pantry/apps/recipe-service/internal/recommend"
)

// recommendPantry ranks the caller's recipes plus the shared catalog against
// the pantry and preferences carried in the request body.
//
// The ranker is stateless by construction: everything about the user arrives
// here in the payload, and this handler only adds the recipe corpus.
func (h *handlers) recommendPantry(w http.ResponseWriter, r *http.Request) {
	var uc recommend.UserContext
	if !decodeJSON(w, r, &uc) {
		return
	}

	candidates, err := h.recommendCandidates(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not load recipes", err)
		return
	}

	results := recommend.RankPantry(uc, candidates)
	// Encode as [] rather than null so clients can render without a nil check.
	if results == nil {
		results = []recommend.Result{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// recommendCandidates assembles the scoring pool: the user's own recipes plus
// the shared catalog, with every ingredient canonicalized here so the recommend
// package never sees raw ingredient text.
func (h *handlers) recommendCandidates(ctx context.Context, userID string) ([]recommend.Candidate, error) {
	mine, err := h.store.ListRecipes(ctx, userID)
	if err != nil {
		return nil, err
	}
	catalog, err := h.store.ListRecipes(ctx, CatalogUserID)
	if err != nil {
		return nil, err
	}

	out := make([]recommend.Candidate, 0, len(mine)+len(catalog))
	out = append(out, toCandidates(mine, "user")...)
	out = append(out, toCandidates(catalog, "catalog")...)
	return out, nil
}

func toCandidates(recs []Recipe, source string) []recommend.Candidate {
	out := make([]recommend.Candidate, 0, len(recs))
	for _, rec := range recs {
		ings := make([]recommend.CandidateIngredient, 0, len(rec.Ingredients))
		for _, ing := range rec.Ingredients {
			canonical, display, _ := normalizer.CanonicalItem(ing.Item)
			ings = append(ings, recommend.CandidateIngredient{
				CanonicalItem: canonical,
				Display:       display,
			})
		}
		out = append(out, recommend.Candidate{
			RecipeID:    rec.ID,
			Title:       rec.Title,
			Source:      source,
			Ingredients: ings,
		})
	}
	return out
}
