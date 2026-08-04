package recipe

import (
	"context"
	"net/http"

	"pantry/apps/recipe-service/internal/nutrition"
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

	candidates, recipes, err := h.recommendCandidates(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not load recipes", err)
		return
	}
	candidates = h.withNutrition(r.Context(), uc, candidates, recipes)

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
//
// The recipes are returned alongside the candidates because nutrition needs the
// quantities and units a Candidate deliberately drops.
func (h *handlers) recommendCandidates(ctx context.Context, userID string) ([]recommend.Candidate, map[string]Recipe, error) {
	mine, err := h.store.ListRecipes(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	catalog, err := h.store.ListRecipes(ctx, CatalogUserID)
	if err != nil {
		return nil, nil, err
	}

	out := make([]recommend.Candidate, 0, len(mine)+len(catalog))
	out = append(out, toCandidates(mine, "user")...)
	out = append(out, toCandidates(catalog, "catalog")...)

	byID := make(map[string]Recipe, len(mine)+len(catalog))
	for _, rec := range mine {
		byID[rec.ID] = rec
	}
	for _, rec := range catalog {
		byID[rec.ID] = rec
	}
	return out, byID, nil
}

// nutritionShortlist bounds how many candidates we buy a nutrition estimate for.
//
// An estimate costs a food lookup per ingredient line, so estimating the whole
// corpus on every request would trade a page that ranks slightly better for one
// that times out. Ranking on the pantry signal first and estimating only the
// leaders is the standard retrieve-then-rerank shape; the number is comfortably
// larger than the default limit of 20 so hard constraints have room to remove.
const nutritionShortlist = 30

// withNutrition attaches per-serving nutrient vectors to the candidates worth
// paying for, and returns the shortlist to rank.
//
// It is a no-op unless the caller actually set goals: with no targets there is
// nothing for the vectors to be scored against, so fetching them would be pure
// cost. Candidates it cannot measure keep a nil vector and are ranked NEUTRALLY
// — see internal/recommend/nutrition.go.
func (h *handlers) withNutrition(
	ctx context.Context,
	uc recommend.UserContext,
	candidates []recommend.Candidate,
	recipes map[string]Recipe,
) []recommend.Candidate {
	if h.nutrition == nil || len(uc.NutritionTargets) == 0 {
		return candidates
	}
	short := recommend.Shortlist(uc, candidates, nutritionShortlist)
	for i := range short {
		rec, ok := recipes[short[i].RecipeID]
		if !ok {
			continue
		}
		short[i].Nutrition = h.estimateCandidate(ctx, rec)
	}
	return short
}

// estimateCandidate reduces one recipe to the per-serving vector the scorer
// wants, or nil when there is no honest per-serving figure to give.
func (h *handlers) estimateCandidate(ctx context.Context, rec Recipe) *recommend.CandidateNutrition {
	// A nil or non-positive yield (BL-0035) means the serving count is unknown.
	// Dividing by a guess would produce a confidently wrong number on a health
	// signal, so the candidate stays unmeasured — and therefore neutral.
	if rec.Servings == nil || *rec.Servings <= 0 {
		return nil
	}

	lines := make([]nutrition.Line, 0, len(rec.Ingredients))
	for _, ing := range rec.Ingredients {
		lines = append(lines, nutrition.Line{Quantity: ing.Quantity, Unit: ing.Unit, Item: ing.Item})
	}
	est := h.nutrition.Estimate(ctx, lines, float64(*rec.Servings))
	if est.PerServing == nil {
		return nil
	}

	per := make(map[string]float64, len(est.PerServing))
	for id, amount := range est.PerServing {
		per[id] = amount.Amount
	}
	return &recommend.CandidateNutrition{
		PerServing: per,
		Coverage: recommend.NutritionCoverage{
			ResolvedMassFraction: est.Coverage.ResolvedMassFraction,
			ResolvedCount:        est.Coverage.ResolvedCount,
			TotalCount:           est.Coverage.TotalCount,
		},
	}
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
