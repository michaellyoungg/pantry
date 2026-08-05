package recipe

import (
	"net/http"
	"sort"

	"pantry/apps/recipe-service/internal/recommend"
)

// --- POST /recommendations/discover (BL-0005 increment 2) ----------------
//
// The sibling of recommendPantry, and deliberately the same shape: decode the
// caller's full user context, add the corpus, rank, encode. Everything specific
// to "what should I try" lives in recommend.RankDiscover; this file is assembly.
//
// It lives in `internal/recipe` rather than `internal/recommend` for the reason
// increment 1 recorded: assembly needs `recipe.Store` and the unexported
// `normalizer`, and the route registers on this package's mux. Putting it in
// `recommend` is an import cycle, and moving the boundary one notch left the
// ranker with ZERO imports — a stronger isolation than the design asked for.
// Keep it that way.
//
// (Not to be confused with `discovery.go` in this package, which owns the
// cuisine/tag/cook-time metadata BL-0020 added to a recipe.)
func (h *handlers) recommendDiscover(w http.ResponseWriter, r *http.Request) {
	var uc recommend.UserContext
	if !decodeJSON(w, r, &uc) {
		return
	}

	candidates, recipes, err := h.recommendCandidates(r.Context(), userIDFrom(r.Context()))
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not load recipes", err)
		return
	}

	// The caller cannot know which catalog rows this user has already cloned —
	// that relationship lives here, in the corpus. Appended to whatever the
	// caller sent rather than replacing it, because the two answer the same
	// question from different sides and neither is complete alone.
	uc.SavedRecipeIDs = append(uc.SavedRecipeIDs, clonedOriginals(recipes)...)

	results := recommend.RankDiscover(uc,
		h.withNutrition(r.Context(), uc, candidates, recipes, recommend.ShortlistDiscover))

	// Deliberately NO generation on this surface (BL-0034 generates only when the
	// pantry corpus comes up thin). An invented recipe is the opposite of a
	// discovery: this surface exists to surface things that already exist and
	// that somebody has cooked.
	//
	// Encode as [] rather than null so clients can render without a nil check.
	if results == nil {
		results = []recommend.Result{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// clonedOriginals lists the catalog recipes this user already has a copy of.
//
// "Add to my recipes" clones a catalog row and freezes `sourceRecipeId` on the
// clone (BL-0020). Both rows are in the candidate pool, so without this the
// discovery surface would offer the user a recipe they already own, sitting
// directly above their own copy of it — the duplicate-listing problem BL-0013
// solved on the catalog page, reappearing one screen over.
//
// Returns a non-nil empty slice: the value is appended to a request field, and a
// nil here would be indistinguishable from an error elsewhere. Sorted because it
// is built by ranging a map, and a function whose output order changes between
// identical calls eventually produces a test that fails one time in ten.
func clonedOriginals(recipes map[string]Recipe) []string {
	out := make([]string, 0, len(recipes))
	seen := make(map[string]bool, len(recipes))
	for _, rec := range recipes {
		if rec.SourceRecipeID == "" || seen[rec.SourceRecipeID] {
			continue
		}
		seen[rec.SourceRecipeID] = true
		out = append(out, rec.SourceRecipeID)
	}
	sort.Strings(out)
	return out
}
