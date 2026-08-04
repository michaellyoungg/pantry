package recipe

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"pantry/apps/recipe-service/internal/nutrition"
)

func nutritionRouter(t *testing.T, store Store) http.Handler {
	t.Helper()
	est := nutrition.NewEstimator(
		DefaultNormalizer(),
		nutrition.SnapshotProvider(),
		nutrition.SnapshotNutrients(),
	)
	return NewRouterWithImporter(store, testSecret, nil, WithNutrition(est))
}

func getNutrition(t *testing.T, srv *httptest.Server, id, userID string) (*http.Response, nutrition.Estimate) {
	t.Helper()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/recipes/"+id+"/nutrition", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Service-Secret", testSecret)
	req.Header.Set("X-User-Id", userID)
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })

	var est nutrition.Estimate
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&est); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return resp, est
}

func TestGetRecipeNutrition(t *testing.T) {
	store := NewMemoryStore()
	rec, err := store.CreateRecipe(context.Background(), "u1", RecipeInput{Title: "Pancakes", Ingredients: []Ingredient{
		{Quantity: 1, Unit: "cup", Item: "flour"},
		{Quantity: 2, Unit: "", Item: "eggs"},
		{Quantity: 1, Unit: "pinch", Item: "salt"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(nutritionRouter(t, store))
	defer srv.Close()

	resp, est := getNutrition(t, srv, rec.ID, "u1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	// flour 125 g at 364 kcal/100 g + 2 eggs at 50 g each and 143 kcal/100 g.
	if got := est.Nutrients["1008"].Amount; got != 598 {
		t.Errorf("energy = %v, want 598", got)
	}
	if got := est.Nutrients["1008"].Unit; got != "kcal" {
		t.Errorf("energy unit = %q, want kcal", got)
	}
	if est.Coverage.TotalCount != 3 || est.Coverage.ResolvedCount != 2 {
		t.Errorf("coverage = %+v, want 2 of 3 resolved", est.Coverage)
	}
	if len(est.Ingredients) != 3 {
		t.Fatalf("got %d ingredient rows, want 3", len(est.Ingredients))
	}
	if est.Ingredients[2].Resolved || est.Ingredients[2].Reason == "" {
		t.Errorf("the pinch of salt = %+v, want unresolved with a reason", est.Ingredients[2])
	}

	// This recipe has no yield, so per-serving must be absent rather than
	// derived from a guess.
	if est.PerServing != nil {
		t.Errorf("PerServing = %+v, want nil when the yield is unknown", est.PerServing)
	}
	if est.Servings != 0 {
		t.Errorf("Servings = %v, want 0 (unknown)", est.Servings)
	}
}

// With a yield on the recipe (BL-0035), the endpoint divides.
func TestGetRecipeNutritionPerServing(t *testing.T) {
	store := NewMemoryStore()
	servings := 4
	rec, err := store.CreateRecipe(context.Background(), "u1", RecipeInput{Title: "Pancakes", Servings: &servings, Ingredients: []Ingredient{
		{Quantity: 1, Unit: "cup", Item: "flour"},
		{Quantity: 2, Unit: "", Item: "eggs"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(nutritionRouter(t, store))
	defer srv.Close()

	resp, est := getNutrition(t, srv, rec.ID, "u1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if est.Servings != 4 {
		t.Errorf("Servings = %v, want 4", est.Servings)
	}
	if est.PerServing == nil {
		t.Fatalf("PerServing is nil despite a known yield")
	}
	// 598 kcal over 4 servings.
	if got := est.PerServing["1008"].Amount; got != 149.5 {
		t.Errorf("per-serving energy = %v, want 149.5", got)
	}
	if got := est.Nutrients["1008"].Amount; got != 598 {
		t.Errorf("totals = %v, want the whole-recipe 598 regardless of the yield", got)
	}
}

// Catalog recipes are owned by the catalog sentinel but readable by everyone;
// without the fallback, nutrition on a catalog recipe would 404.
func TestGetRecipeNutritionFallsBackToCatalog(t *testing.T) {
	store := NewMemoryStore()
	if err := store.UpsertRecipe(context.Background(), Recipe{
		ID: "cat-1", UserID: CatalogUserID, Title: "Catalog dish",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "rice"}},
	}); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(nutritionRouter(t, store))
	defer srv.Close()

	resp, est := getNutrition(t, srv, "cat-1", "u1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if est.Coverage.ResolvedCount != 1 {
		t.Errorf("coverage = %+v, want the rice resolved", est.Coverage)
	}
}

func TestGetRecipeNutritionNotFound(t *testing.T) {
	srv := httptest.NewServer(nutritionRouter(t, NewMemoryStore()))
	defer srv.Close()

	if resp, _ := getNutrition(t, srv, "nope", "u1"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// A recipe belonging to someone else must not leak through the catalog fallback.
func TestGetRecipeNutritionIsUserScoped(t *testing.T) {
	store := NewMemoryStore()
	rec, err := store.CreateRecipe(context.Background(), "u1", RecipeInput{Title: "Private", Ingredients: []Ingredient{
		{Quantity: 1, Unit: "cup", Item: "flour"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(nutritionRouter(t, store))
	defer srv.Close()

	if resp, _ := getNutrition(t, srv, rec.ID, "u2"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for another user's recipe", resp.StatusCode)
	}
}

func TestGetRecipeNutritionRequiresTheServiceSecret(t *testing.T) {
	srv := httptest.NewServer(nutritionRouter(t, NewMemoryStore()))
	defer srv.Close()

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/recipes/r1/nutrition", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

// Not configured behaves like import does: an explicit 503, not a 404 that
// looks like the recipe is missing.
func TestGetRecipeNutritionUnconfigured(t *testing.T) {
	store := NewMemoryStore()
	rec, err := store.CreateRecipe(context.Background(), "u1", RecipeInput{Title: "Pancakes"})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(NewRouterWithImporter(store, testSecret, nil))
	defer srv.Close()

	if resp, _ := getNutrition(t, srv, rec.ID, "u1"); resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", resp.StatusCode)
	}
}

// TestNormalizerUnitsNutritionReliesOn pins the unit table from the recipe side.
// internal/nutrition cannot import this package (that would be a cycle), so its
// tests carry a copy of these values; if normalization.json changes, this fails
// here rather than silently shifting every gram weight nutrition computes.
func TestNormalizerUnitsNutritionReliesOn(t *testing.T) {
	want := map[string]struct {
		dim    string
		toBase float64
	}{
		"tsp":  {"volume", 4.92892},
		"tbsp": {"volume", 14.7868},
		"cup":  {"volume", 236.588},
		"ml":   {"volume", 1},
		"l":    {"volume", 1000},
		"g":    {"mass", 1},
		"kg":   {"mass", 1000},
		"oz":   {"mass", 28.3495},
		"lb":   {"mass", 453.592},
	}
	n := DefaultNormalizer()
	for unit, w := range want {
		dim, toBase, ok := n.Unit(unit)
		if !ok {
			t.Errorf("unit %q disappeared from normalization.json", unit)
			continue
		}
		if dim != w.dim || toBase != w.toBase {
			t.Errorf("unit %q = (%s, %v), want (%s, %v) — internal/nutrition's test table must match",
				unit, dim, toBase, w.dim, w.toBase)
		}
	}
}
