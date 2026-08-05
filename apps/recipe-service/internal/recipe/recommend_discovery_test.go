package recipe

import (
	"context"
	"testing"
)

// The facets are stored on the recipe but scored in a package that never sees a
// Recipe, so the handler has to carry them across. Without this the ranker's
// discovery features are wired and permanently inert — the exact state BL-0030
// exists to end.
func TestRecommendPantryScoresTheStoredCuisine(t *testing.T) {
	srv, store := newTestServer(t)
	seedRice := func(id, title, cuisine string) {
		t.Helper()
		if err := store.UpsertRecipe(context.Background(), Recipe{
			ID: id, UserID: CatalogUserID, Title: title, Cuisine: cuisine,
			Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "rice"}},
		}); err != nil {
			t.Fatalf("upsert: %v", err)
		}
	}
	seedRice("cat-italian", "Risotto", "italian")
	seedRice("cat-thai", "Thai Rice", "thai")

	out := postRecommendations(t, srv.URL, map[string]any{
		"pantry":      []map[string]any{{"canonicalItem": "rice", "state": "have"}},
		"preferences": map[string]any{"cuisines": []string{"thai"}},
	})

	if len(out.Results) != 2 {
		t.Fatalf("got %d results, want 2", len(out.Results))
	}
	if out.Results[0].RecipeID != "cat-thai" {
		t.Fatalf("first result = %q, want cat-thai (order: %+v)", out.Results[0].RecipeID, out.Results)
	}
}

// The trap, end to end: a recipe nobody timed must not win a request for
// something quick.
func TestRecommendPantryDoesNotTreatAnUntimedRecipeAsFast(t *testing.T) {
	srv, store := newTestServer(t)
	twenty := 20
	if err := store.UpsertRecipe(context.Background(), Recipe{
		ID: "cat-quick", UserID: CatalogUserID, Title: "Quick Rice", TotalMinutes: &twenty,
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "rice"}},
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if err := store.UpsertRecipe(context.Background(), Recipe{
		ID: "cat-untimed", UserID: CatalogUserID, Title: "Untimed Rice",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "rice"}},
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	out := postRecommendations(t, srv.URL, map[string]any{
		"pantry":      []map[string]any{{"canonicalItem": "rice", "state": "have"}},
		"preferences": map[string]any{"maxMinutes": 30},
	})

	if len(out.Results) != 2 {
		t.Fatalf("got %d results, want 2", len(out.Results))
	}
	if out.Results[0].RecipeID != "cat-quick" {
		t.Fatalf("first result = %q, want cat-quick (order: %+v)", out.Results[0].RecipeID, out.Results)
	}
}
