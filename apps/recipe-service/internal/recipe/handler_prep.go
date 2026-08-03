package recipe

import (
	"log/slog"
	"net/http"
	"time"
)

// maxPrepMeals caps one request. A planner week is seven dinners; anything an
// order of magnitude past that is a client bug, and derivation is cheap enough
// that the cap exists to bound the response, not the work.
const maxPrepMeals = 100

// PrepMeal is one derived meal in the POST /prep-tasks response.
type PrepMeal struct {
	RecipeID string `json:"recipeId"`
	// Title is denormalized so the caller can label a task ("Chili — move the
	// chicken to the fridge") without a second round trip per meal.
	Title    string     `json:"title"`
	CookDate string     `json:"cookDate"`
	Tasks    []PrepTask `json:"tasks"`
}

// PrepTasksResponse groups derived tasks by meal.
type PrepTasksResponse struct {
	// RulesVersion is the revision of the rule table that produced these tasks.
	// It is what makes a rule change traceable from the output back to the
	// commit that caused it.
	RulesVersion string     `json:"rulesVersion"`
	Meals        []PrepMeal `json:"meals"`
}

// prepTasks derives lead-time prep for a set of planned meals (BL-0042).
//
// The call shape mirrors POST /grocery-list — a list of recipe ids plus a
// per-entry qualifier — so Convex reaches it through an action the same way and
// the service-secret plumbing is unchanged.
//
// `cookDate` is required per meal and `today` is optional, both as bare ISO
// dates supplied by the caller. Neither is derived from the server clock on
// purpose: the browser knows the user's local date and the server does not, and
// a prep schedule that slips a day is worse than no prep schedule.
func (h *handlers) prepTasks(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Meals []struct {
			RecipeID string `json:"recipeId"`
			CookDate string `json:"cookDate"`
		} `json:"meals"`
		Today string `json:"today"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.Meals) > maxPrepMeals {
		writeError(w, r, http.StatusBadRequest, "too many meals in one request")
		return
	}
	if req.Today != "" && !validISODate(req.Today) {
		writeError(w, r, http.StatusBadRequest, "today must be an ISO date (YYYY-MM-DD)")
		return
	}

	ids := make([]string, 0, len(req.Meals))
	for _, m := range req.Meals {
		if !validISODate(m.CookDate) {
			writeError(w, r, http.StatusBadRequest, "cookDate must be an ISO date (YYYY-MM-DD)")
			return
		}
		ids = append(ids, m.RecipeID)
	}

	// Catalog recipes are owned by CatalogUserID but plannable by anyone, so the
	// same helper the grocery list and the nutrition rollup use resolves both
	// scopes here too.
	byID, err := h.readableRecipes(r.Context(), ids)
	if err != nil {
		writeErr(w, r, http.StatusInternalServerError, "could not load recipes", err)
		return
	}

	meals := make([]PrepMeal, 0, len(req.Meals))
	skipped := make([]string, 0)
	for _, m := range req.Meals {
		rec, ok := byID[m.RecipeID]
		if !ok {
			skipped = append(skipped, m.RecipeID)
			continue
		}
		// Parsed in UTC and used only for date arithmetic — the value never
		// represents an instant, so no timezone is being asserted here.
		cookDate, _ := time.Parse(isoDate, m.CookDate)
		meals = append(meals, PrepMeal{
			RecipeID: m.RecipeID,
			Title:    rec.Title,
			CookDate: m.CookDate,
			Tasks:    MarkMissed(DerivePrepTasks(rec, cookDate), req.Today),
		})
	}
	// A plan can outlive the recipe it points at. Dropping the entry is right —
	// there is no prep for a recipe we cannot read — but doing it silently is
	// how an empty "Before you cook" card hides a real bug.
	if len(skipped) > 0 {
		slog.WarnContext(r.Context(), "prep-tasks: skipped unresolvable recipe ids",
			"count", len(skipped), "ids", skipped)
	}

	writeJSON(w, http.StatusOK, PrepTasksResponse{RulesVersion: PrepRulesVersion(), Meals: meals})
}

// validISODate accepts exactly YYYY-MM-DD. time.Parse alone would also accept a
// date that rolls over ("2026-02-31"), which is a client bug worth reporting
// rather than silently normalizing into March.
func validISODate(s string) bool {
	t, err := time.Parse(isoDate, s)
	return err == nil && t.Format(isoDate) == s
}
