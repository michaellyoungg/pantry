package recipe

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// End-to-end cover for BL-0040: the goals arrive on the request, the handler
// estimates the shortlist against the checked-in snapshot, and the ranker turns
// the result into a filter or a reordering. Nothing here is stubbed, so the
// units the targets are written in have to match the units the estimator emits.

type recNutritionResponse struct {
	Results []struct {
		RecipeID            string   `json:"recipeId"`
		Title               string   `json:"title"`
		NutritionFit        *float64 `json:"nutritionFit"`
		NutritionUnverified []struct {
			NutrientID string `json:"nutrientId"`
			Label      string `json:"label"`
		} `json:"nutritionUnverified"`
	} `json:"results"`
}

func postRecommendationsWithNutrition(t *testing.T, srv *httptest.Server, body any) recNutritionResponse {
	t.Helper()
	buf, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	resp := doAuth(t, http.MethodPost, srv.URL+"/recommendations/pantry", bytes.NewReader(buf))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var out recNutritionResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

func titles(out recNutritionResponse) []string {
	xs := make([]string, 0, len(out.Results))
	for _, r := range out.Results {
		xs = append(xs, r.Title)
	}
	return xs
}

func seedWithServings(t *testing.T, store Store, title string, servings *int, ings ...Ingredient) {
	t.Helper()
	if _, err := store.CreateRecipe(context.Background(), "user-a", title, servings, ings, nil, nil, nil); err != nil {
		t.Fatalf("create %q: %v", title, err)
	}
}

func servings(n int) *int { return &n }

// A hard cholesterol cap removes the dish that measurably breaks it, and leaves
// the one that does not.
func TestRecommendPantry_HardConstraintFiltersOnRealEstimates(t *testing.T) {
	store := NewMemoryStore()
	srv := httptest.NewServer(nutritionRouter(t, store))
	defer srv.Close()

	// 6 eggs over 1 serving is ~2,232 mg cholesterol; rice and olive oil have
	// none at all in the snapshot.
	seedWithServings(t, store, "Egg mountain", servings(1),
		Ingredient{Quantity: 6, Unit: "large", Item: "eggs"},
		Ingredient{Quantity: 1, Unit: "cup", Item: "rice"})
	seedWithServings(t, store, "Rice bowl", servings(1),
		Ingredient{Quantity: 1, Unit: "cup", Item: "rice"},
		Ingredient{Quantity: 1, Unit: "tbsp", Item: "olive oil"})

	out := postRecommendationsWithNutrition(t, srv, map[string]any{
		"pantry": []map[string]any{
			{"canonicalItem": "rice", "state": "have"},
			{"canonicalItem": "egg", "state": "have"},
			{"canonicalItem": "olive oil", "state": "have"},
		},
		"nutritionTargets": []map[string]any{
			{"nutrientId": "1253", "operator": "<=", "value": 200, "period": "meal", "hard": true},
		},
	})

	got := titles(out)
	if len(got) != 1 || got[0] != "Rice bowl" {
		t.Fatalf("results = %v, want only the dish under the cap", got)
	}
}

// The same target without the flag must not remove anything — the operator does
// not decide filtering, the user's flag does.
func TestRecommendPantry_SoftCapReordersRatherThanFilters(t *testing.T) {
	store := NewMemoryStore()
	srv := httptest.NewServer(nutritionRouter(t, store))
	defer srv.Close()

	seedWithServings(t, store, "Egg mountain", servings(1),
		Ingredient{Quantity: 6, Unit: "large", Item: "eggs"},
		Ingredient{Quantity: 1, Unit: "cup", Item: "rice"})
	seedWithServings(t, store, "Rice bowl", servings(1),
		Ingredient{Quantity: 1, Unit: "cup", Item: "rice"},
		Ingredient{Quantity: 1, Unit: "tbsp", Item: "olive oil"})

	out := postRecommendationsWithNutrition(t, srv, map[string]any{
		"pantry": []map[string]any{
			{"canonicalItem": "rice", "state": "have"},
			{"canonicalItem": "egg", "state": "have"},
			{"canonicalItem": "olive oil", "state": "have"},
		},
		"nutritionTargets": []map[string]any{
			{"nutrientId": "1253", "operator": "<=", "value": 200, "period": "meal"},
		},
	})

	got := titles(out)
	if len(got) != 2 {
		t.Fatalf("results = %v, want both dishes kept", got)
	}
	if got[0] != "Rice bowl" {
		t.Fatalf("results = %v, want the low-cholesterol dish ranked first", got)
	}
}

// A recipe with no yield has no honest per-serving figure (BL-0035). It survives
// a hard constraint — it was never shown to break it — but says so.
func TestRecommendPantry_UnmeasurableRecipeSurvivesAndIsFlagged(t *testing.T) {
	store := NewMemoryStore()
	srv := httptest.NewServer(nutritionRouter(t, store))
	defer srv.Close()

	seedWithServings(t, store, "Mystery bowl", nil,
		Ingredient{Quantity: 6, Unit: "large", Item: "eggs"},
		Ingredient{Quantity: 1, Unit: "cup", Item: "rice"})

	out := postRecommendationsWithNutrition(t, srv, map[string]any{
		"pantry": []map[string]any{
			{"canonicalItem": "rice", "state": "have"},
			{"canonicalItem": "egg", "state": "have"},
		},
		"nutritionTargets": []map[string]any{
			{
				"nutrientId": "1253", "operator": "<=", "value": 200,
				"period": "meal", "hard": true, "label": "Low cholesterol",
			},
		},
	})

	if len(out.Results) != 1 {
		t.Fatalf("results = %v, want the unmeasurable recipe kept", titles(out))
	}
	r := out.Results[0]
	if r.NutritionFit != nil {
		t.Fatalf("nutritionFit = %v, want null for an unmeasurable recipe", *r.NutritionFit)
	}
	if len(r.NutritionUnverified) != 1 || r.NutritionUnverified[0].Label != "Low cholesterol" {
		t.Fatalf("nutritionUnverified = %+v, want the unchecked constraint named", r.NutritionUnverified)
	}
}

// Set-level fit over the wire: the same dish against the same week target scores
// higher once the plan has nearly closed the gap.
func TestRecommendPantry_WeekTargetScoresAgainstThePlansRemainingGap(t *testing.T) {
	store := NewMemoryStore()
	srv := httptest.NewServer(nutritionRouter(t, store))
	defer srv.Close()

	seedWithServings(t, store, "Chicken and rice", servings(2),
		Ingredient{Quantity: 1, Unit: "breast", Item: "chicken breast"},
		Ingredient{Quantity: 1, Unit: "cup", Item: "rice"})

	body := func(plan map[string]any) map[string]any {
		b := map[string]any{
			"pantry": []map[string]any{
				{"canonicalItem": "rice", "state": "have"},
				{"canonicalItem": "chicken breast", "state": "have"},
			},
			"nutritionTargets": []map[string]any{
				{"nutrientId": "1003", "operator": ">=", "value": 700, "period": "week"},
			},
		}
		if plan != nil {
			b["planNutrition"] = plan
		}
		return b
	}

	empty := postRecommendationsWithNutrition(t, srv, body(nil))
	nearlyThere := postRecommendationsWithNutrition(t, srv, body(map[string]any{
		"nutrients": map[string]float64{"1003": 690},
		"coverage": map[string]any{
			"resolvedMassFraction": 1.0, "resolvedCount": 9, "totalCount": 9,
		},
	}))

	if len(empty.Results) != 1 || len(nearlyThere.Results) != 1 {
		t.Fatalf("expected one result each, got %v and %v", titles(empty), titles(nearlyThere))
	}
	if empty.Results[0].NutritionFit == nil || nearlyThere.Results[0].NutritionFit == nil {
		t.Fatal("a measurable recipe reported no fit")
	}
	if *nearlyThere.Results[0].NutritionFit <= *empty.Results[0].NutritionFit {
		t.Fatalf("closing the remaining gap did not score higher: %v vs %v",
			*nearlyThere.Results[0].NutritionFit, *empty.Results[0].NutritionFit)
	}
}

// With no goals set, nothing is estimated and nothing changes. This is the path
// every user who has never opened the goals screen takes.
func TestRecommendPantry_NoTargetsMeansNoNutritionWork(t *testing.T) {
	store := NewMemoryStore()
	srv := httptest.NewServer(nutritionRouter(t, store))
	defer srv.Close()

	seedWithServings(t, store, "Egg mountain", servings(1),
		Ingredient{Quantity: 6, Unit: "large", Item: "eggs"},
		Ingredient{Quantity: 1, Unit: "cup", Item: "rice"})

	out := postRecommendationsWithNutrition(t, srv, map[string]any{
		"pantry": []map[string]any{
			{"canonicalItem": "rice", "state": "have"},
			{"canonicalItem": "egg", "state": "have"},
		},
	})

	if len(out.Results) != 1 {
		t.Fatalf("results = %v, want the recipe", titles(out))
	}
	if out.Results[0].NutritionFit != nil {
		t.Fatalf("nutritionFit = %v, want null when the user has set no goals", *out.Results[0].NutritionFit)
	}
}
