package recipe

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"pantry/apps/recipe-service/internal/nutrition"
)

func rollupServer(t *testing.T) (*httptest.Server, Store) {
	t.Helper()
	store := NewMemoryStore()
	srv := httptest.NewServer(nutritionRouter(t, store))
	t.Cleanup(srv.Close)
	return srv, store
}

func postRollup(t *testing.T, srv *httptest.Server, userID, body string) (*http.Response, nutrition.Estimate) {
	t.Helper()
	resp := doAuthAs(t, http.MethodPost, srv.URL+"/nutrition/estimate", userID, strings.NewReader(body))
	t.Cleanup(func() { _ = resp.Body.Close() })

	var est nutrition.Estimate
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&est); err != nil {
			t.Fatalf("decode estimate: %v", err)
		}
	}
	return resp, est
}

func mustRecipe(t *testing.T, store Store, userID, title string, ings []Ingredient) Recipe {
	t.Helper()
	rec, err := store.CreateRecipe(context.Background(), userID, title, nil, ings, nil)
	if err != nil {
		t.Fatal(err)
	}
	return rec
}

func energy(t *testing.T, est nutrition.Estimate) float64 {
	t.Helper()
	n, ok := est.Nutrients["1008"]
	if !ok {
		t.Fatalf("energy missing from %+v", est.Nutrients)
	}
	return n.Amount
}

func TestNutritionEstimateCombinesRecipes(t *testing.T) {
	srv, store := rollupServer(t)
	a := mustRecipe(t, store, "user-a", "Pancakes", []Ingredient{{Quantity: 1, Unit: "cup", Item: "flour"}})
	b := mustRecipe(t, store, "user-a", "Milk", []Ingredient{{Quantity: 1, Unit: "cup", Item: "milk"}})

	_, one := postRollup(t, srv, "user-a", `{"items":[{"recipeId":"`+a.ID+`","multiplier":1}]}`)
	_, both := postRollup(t, srv, "user-a",
		`{"items":[{"recipeId":"`+a.ID+`","multiplier":1},{"recipeId":"`+b.ID+`","multiplier":1}]}`)

	if energy(t, both) <= energy(t, one) {
		t.Errorf("two recipes = %v kcal, one = %v; the second must add", energy(t, both), energy(t, one))
	}
	if len(both.Recipes) != 2 {
		t.Fatalf("recipes = %d, want 2", len(both.Recipes))
	}
	for _, rc := range both.Recipes {
		if !rc.Counted {
			t.Errorf("%q counted = false, want true", rc.Title)
		}
		if rc.Coverage.TotalCount != 1 {
			t.Errorf("%q coverage = %+v, want 1 line", rc.Title, rc.Coverage)
		}
	}
	if both.Recipes[0].Title != "Pancakes" || both.Recipes[1].Title != "Milk" {
		t.Errorf("recipes = %+v, want request order with titles", both.Recipes)
	}
	// A plan has no yield. Per-serving figures here would be invented.
	if both.PerServing != nil {
		t.Errorf("perServing = %v, want nil", both.PerServing)
	}
}

// The multiplier is the planner's servings dial, and it must reach nutrition on
// exactly the terms it reaches the grocery list.
func TestNutritionEstimateAppliesTheMultiplier(t *testing.T) {
	srv, store := rollupServer(t)
	rec := mustRecipe(t, store, "user-a", "Pancakes", []Ingredient{{Quantity: 1, Unit: "cup", Item: "flour"}})

	_, single := postRollup(t, srv, "user-a", `{"items":[{"recipeId":"`+rec.ID+`","multiplier":1}]}`)
	_, double := postRollup(t, srv, "user-a", `{"items":[{"recipeId":"`+rec.ID+`","multiplier":2}]}`)

	if got, want := energy(t, double), 2*energy(t, single); math.Abs(got-want) > 0.01 {
		t.Errorf("×2 = %v kcal, want %v", got, want)
	}
	if got := double.Recipes[0].Multiplier; got != 2 {
		t.Errorf("reported multiplier = %v, want 2", got)
	}
}

// An absent or nonsensical dial means one batch — the same rule AggregateScaled
// applies, read through the same method.
func TestNutritionEstimateDefaultsTheMultiplier(t *testing.T) {
	srv, store := rollupServer(t)
	rec := mustRecipe(t, store, "user-a", "Pancakes", []Ingredient{{Quantity: 1, Unit: "cup", Item: "flour"}})

	_, one := postRollup(t, srv, "user-a", `{"items":[{"recipeId":"`+rec.ID+`","multiplier":1}]}`)
	_, absent := postRollup(t, srv, "user-a", `{"items":[{"recipeId":"`+rec.ID+`"}]}`)

	if math.Abs(energy(t, absent)-energy(t, one)) > 0.01 {
		t.Errorf("no multiplier = %v kcal, want %v", energy(t, absent), energy(t, one))
	}
	if got := absent.Recipes[0].Multiplier; got != 1 {
		t.Errorf("reported multiplier = %v, want 1", got)
	}
}

// The failure this feature exists to prevent: a day whose dinner has been
// deleted must not report a confident total for the two dishes it still has.
func TestNutritionEstimateReportsUnresolvableRecipes(t *testing.T) {
	srv, store := rollupServer(t)
	rec := mustRecipe(t, store, "user-a", "Pancakes", []Ingredient{{Quantity: 1, Unit: "cup", Item: "flour"}})

	resp, est := postRollup(t, srv, "user-a",
		`{"items":[{"recipeId":"`+rec.ID+`","multiplier":1},{"recipeId":"gone","multiplier":1}]}`)

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a stale basket entry is not a request failure", resp.StatusCode)
	}
	if len(est.Recipes) != 2 {
		t.Fatalf("recipes = %+v, want both entries accounted for", est.Recipes)
	}
	if !est.Recipes[0].Counted {
		t.Error("the live recipe should be counted")
	}
	missing := est.Recipes[1]
	if missing.Counted {
		t.Error("a deleted recipe must be reported as uncounted, not dropped")
	}
	if missing.RecipeID != "gone" {
		t.Errorf("uncounted recipe id = %q, want \"gone\"", missing.RecipeID)
	}
	// Its food is missing from both sides of the mass ratio, so the blended
	// figure cannot express it — which is exactly why `counted` exists.
	if est.Coverage.ResolvedMassFraction < 0.99 {
		t.Errorf("coverage = %v; the counted recipe's own coverage is unaffected", est.Coverage)
	}
}

// A recipe belonging to someone else is as absent as a deleted one, and must be
// reported the same way rather than silently counted.
func TestNutritionEstimateDoesNotLeakAnotherUsersRecipe(t *testing.T) {
	srv, store := rollupServer(t)
	theirs := mustRecipe(t, store, "user-b", "Secret", []Ingredient{{Quantity: 1, Unit: "cup", Item: "flour"}})

	_, est := postRollup(t, srv, "user-a", `{"items":[{"recipeId":"`+theirs.ID+`","multiplier":1}]}`)

	if len(est.Recipes) != 1 || est.Recipes[0].Counted {
		t.Errorf("recipes = %+v, want one uncounted entry", est.Recipes)
	}
	if est.Recipes[0].Title != "" {
		t.Errorf("title = %q, want empty — an unreadable recipe leaks nothing", est.Recipes[0].Title)
	}
	if len(est.Nutrients) != 0 {
		t.Errorf("nutrients = %+v, want empty", est.Nutrients)
	}
}

// Catalog recipes are owned by the catalog sentinel user but planned by
// everyone; the rollup resolves them the same way the grocery list does.
func TestNutritionEstimateResolvesCatalogRecipes(t *testing.T) {
	srv, store := rollupServer(t)
	cat := mustRecipe(t, store, CatalogUserID, "Catalog Pancakes", []Ingredient{{Quantity: 1, Unit: "cup", Item: "flour"}})

	_, est := postRollup(t, srv, "user-a", `{"items":[{"recipeId":"`+cat.ID+`","multiplier":1}]}`)

	if len(est.Recipes) != 1 || !est.Recipes[0].Counted {
		t.Fatalf("recipes = %+v, want the catalog recipe counted", est.Recipes)
	}
	if energy(t, est) <= 0 {
		t.Errorf("energy = %v, want the catalog recipe's flour to count", energy(t, est))
	}
}

// Per-recipe coverage is what lets a client name the dish that dragged a day
// down instead of showing one blended percentage.
func TestNutritionEstimateReportsPerRecipeCoverage(t *testing.T) {
	srv, store := rollupServer(t)
	good := mustRecipe(t, store, "user-a", "Flour", []Ingredient{{Quantity: 500, Unit: "g", Item: "flour"}})
	bad := mustRecipe(t, store, "user-a", "Mystery", []Ingredient{{Quantity: 500, Unit: "g", Item: "unicorn tears"}})

	_, est := postRollup(t, srv, "user-a",
		`{"items":[{"recipeId":"`+good.ID+`","multiplier":1},{"recipeId":"`+bad.ID+`","multiplier":1}]}`)

	if got := est.Recipes[0].Coverage.ResolvedMassFraction; got < 0.99 {
		t.Errorf("Flour coverage = %v, want ~1", got)
	}
	if got := est.Recipes[1].Coverage.ResolvedMassFraction; got != 0 {
		t.Errorf("Mystery coverage = %v, want 0", got)
	}
	if got := est.Coverage.ResolvedMassFraction; math.Abs(got-0.5) > 0.001 {
		t.Errorf("combined coverage = %v, want 0.5", got)
	}
}

func TestNutritionEstimateEmptyPlan(t *testing.T) {
	srv, _ := rollupServer(t)
	resp, est := postRollup(t, srv, "user-a", `{"items":[]}`)

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if len(est.Recipes) != 0 || len(est.Nutrients) != 0 || est.Coverage.TotalCount != 0 {
		t.Errorf("empty plan produced %+v", est)
	}
}

func TestNutritionEstimateRequiresServiceSecret(t *testing.T) {
	srv, _ := rollupServer(t)
	resp, err := http.Post(srv.URL+"/nutrition/estimate", "application/json", strings.NewReader(`{"items":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestNutritionEstimateUnconfigured(t *testing.T) {
	store := NewMemoryStore()
	srv := httptest.NewServer(NewRouter(store, testSecret))
	defer srv.Close()

	resp := doAuth(t, http.MethodPost, srv.URL+"/nutrition/estimate", strings.NewReader(`{"items":[]}`))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", resp.StatusCode)
	}
}
