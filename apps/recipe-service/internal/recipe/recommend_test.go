package recipe

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

type recResponse struct {
	Results []struct {
		RecipeID string   `json:"recipeId"`
		Title    string   `json:"title"`
		Source   string   `json:"source"`
		Score    float64  `json:"score"`
		Reasons  []string `json:"reasons"`
		Have     []string `json:"have"`
		Missing  []struct {
			CanonicalItem string `json:"canonicalItem"`
			Display       string `json:"display"`
			Staple        bool   `json:"staple"`
		} `json:"missing"`
	} `json:"results"`
}

func postRecommendations(t *testing.T, srv string, body any) recResponse {
	t.Helper()
	buf, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	resp := doAuth(t, http.MethodPost, srv+"/recommendations/pantry", bytes.NewReader(buf))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var out recResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

func TestRecommendPantryRanksOwnAndCatalogRecipes(t *testing.T) {
	srv, store := newTestServer(t)

	if _, err := store.CreateRecipe(context.Background(), "user-a", RecipeInput{Title: "Garlic Rice", Ingredients: []Ingredient{
		{Quantity: 1, Unit: "cup", Item: "rice"},
		{Quantity: 2, Unit: "cloves", Item: "garlic"},
	}}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := store.UpsertRecipe(context.Background(), Recipe{
		ID: "cat-x", UserID: CatalogUserID, Title: "Catalog Rice",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cup", Item: "rice"}},
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	out := postRecommendations(t, srv.URL, map[string]any{
		"pantry": []map[string]any{
			{"canonicalItem": "rice", "state": "have"},
			{"canonicalItem": "garlic", "state": "have"},
		},
	})

	if len(out.Results) != 2 {
		t.Fatalf("got %d results, want 2: %+v", len(out.Results), out.Results)
	}
	sources := map[string]string{}
	for _, r := range out.Results {
		sources[r.Title] = r.Source
	}
	if sources["Garlic Rice"] != "user" {
		t.Fatalf("Garlic Rice source = %q, want user", sources["Garlic Rice"])
	}
	if sources["Catalog Rice"] != "catalog" {
		t.Fatalf("Catalog Rice source = %q, want catalog", sources["Catalog Rice"])
	}
}

// Ingredient text must be canonicalized before scoring — "scallions" and
// "green onion" are the same pantry row.
func TestRecommendPantryCanonicalizesIngredients(t *testing.T) {
	srv, store := newTestServer(t)
	if _, err := store.CreateRecipe(context.Background(), "user-a", RecipeInput{Title: "Scallion Bowl", Ingredients: []Ingredient{
		{Quantity: 2, Unit: "whole", Item: "scallions"},
	}}); err != nil {
		t.Fatalf("create: %v", err)
	}

	out := postRecommendations(t, srv.URL, map[string]any{
		"pantry": []map[string]any{{"canonicalItem": "green onion", "state": "have"}},
	})

	if len(out.Results) != 1 {
		t.Fatalf("got %d results, want 1", len(out.Results))
	}
	if len(out.Results[0].Have) != 1 || out.Results[0].Have[0] != "green onion" {
		t.Fatalf("have = %v, want [green onion]", out.Results[0].Have)
	}
}

// Cross-user isolation: another user's private recipe must never be a candidate.
func TestRecommendPantryNeverLeaksAnotherUsersRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	if _, err := store.CreateRecipe(context.Background(), "user-b", RecipeInput{Title: "Secret Rice", Ingredients: []Ingredient{
		{Quantity: 1, Unit: "cup", Item: "rice"},
	}}); err != nil {
		t.Fatalf("create: %v", err)
	}

	out := postRecommendations(t, srv.URL, map[string]any{
		"pantry": []map[string]any{{"canonicalItem": "rice", "state": "have"}},
	})

	for _, r := range out.Results {
		if r.Title == "Secret Rice" {
			t.Fatal("leaked another user's recipe into recommendations")
		}
	}
}

func TestRecommendPantryAppliesAvoidList(t *testing.T) {
	srv, store := newTestServer(t)
	if _, err := store.CreateRecipe(context.Background(), "user-a", RecipeInput{Title: "Peanut Rice", Ingredients: []Ingredient{
		{Quantity: 1, Unit: "cup", Item: "rice"},
		{Quantity: 2, Unit: "tbsp", Item: "peanut"},
	}}); err != nil {
		t.Fatalf("create: %v", err)
	}

	out := postRecommendations(t, srv.URL, map[string]any{
		"pantry":      []map[string]any{{"canonicalItem": "rice", "state": "have"}},
		"preferences": map[string]any{"avoidItems": []string{"peanut"}},
	})

	if len(out.Results) != 0 {
		t.Fatalf("avoided recipe surfaced: %+v", out.Results)
	}
}

func TestRecommendPantryReturnsEmptyListNotNull(t *testing.T) {
	srv, _ := newTestServer(t)
	out := postRecommendations(t, srv.URL, map[string]any{"pantry": []map[string]any{}})
	if out.Results == nil {
		t.Fatal("results was null; must serialize as []")
	}
}

func TestRecommendPantryRejectsMalformedBody(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/recommendations/pantry", bytes.NewReader([]byte("{")))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestRecommendPantryRequiresAuth(t *testing.T) {
	srv, _ := newTestServer(t)
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/recommendations/pantry", bytes.NewReader([]byte("{}")))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

// The end-to-end proof that BL-0031 actually unblocked BL-0005's dormant
// feature: the staple flag has to travel from normalization.json, through
// canonicalization here, into the ranker. Testing it at the HTTP boundary is
// what catches the plumbing being wrong even though both halves are right.
func TestRecommendPantryTreatsMissingStaplesAsCheap(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	// Both recipes cover the pantry identically; only the third ingredient
	// differs, and only in whether it is something you must go and buy.
	if _, err := store.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Needs Salt", Ingredients: []Ingredient{
		{Quantity: 1, Unit: "", Item: "tomato"},
		{Quantity: 1, Unit: "", Item: "onion"},
		{Quantity: 1, Unit: "tsp", Item: "kosher salt"},
	}}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := store.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Needs Beef", Ingredients: []Ingredient{
		{Quantity: 1, Unit: "", Item: "tomato"},
		{Quantity: 1, Unit: "", Item: "onion"},
		{Quantity: 1, Unit: "lb", Item: "ground beef"},
	}}); err != nil {
		t.Fatalf("create: %v", err)
	}

	out := postRecommendations(t, srv.URL, map[string]any{
		"pantry": []map[string]any{
			{"canonicalItem": "tomato", "state": "have"},
			{"canonicalItem": "onion", "state": "have"},
		},
	})

	var salt, beef float64
	var saltStaple, beefStaple bool
	for _, r := range out.Results {
		for _, m := range r.Missing {
			switch m.CanonicalItem {
			case "salt":
				salt, saltStaple = r.Score, m.Staple
			case "ground beef":
				beef, beefStaple = r.Score, m.Staple
			}
		}
	}
	if salt == 0 || beef == 0 {
		t.Fatalf("expected both recipes back with a missing item, got %+v", out.Results)
	}
	if !saltStaple {
		t.Error(`"kosher salt" should resolve to the staple salt`)
	}
	if beefStaple {
		t.Error("ground beef must not be a staple")
	}
	if salt <= beef {
		t.Fatalf("missing salt scored %v, missing beef %v — the staple flag is not reaching the ranker", salt, beef)
	}
}
