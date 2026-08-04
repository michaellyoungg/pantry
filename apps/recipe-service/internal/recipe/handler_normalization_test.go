package recipe

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func postJSON(t *testing.T, url, body string) *http.Response {
	t.Helper()
	return doAuth(t, http.MethodPost, url, strings.NewReader(body))
}

func TestNormalizationLookup_CanonicalizesRawTextAndReturnsShelfLife(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := postJSON(t, srv.URL+"/normalization/lookup", `{"items":[" Tomatoes ","Scallions"]}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got struct {
		Items []ItemDetails `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 2 {
		t.Fatalf("got %d items, want 2: %+v", len(got.Items), got.Items)
	}
	if got.Items[0].CanonicalItem != "tomato" || got.Items[0].ShelfLifeDays != 5 || got.Items[0].Aisle != "produce" {
		t.Errorf("tomatoes -> %+v", got.Items[0])
	}
	if got.Items[1].CanonicalItem != "green onion" || got.Items[1].ShelfLifeDays != 10 {
		t.Errorf("scallions -> %+v", got.Items[1])
	}
}

func TestNormalizationLookup_OmitsShelfLifeForUnknownItems(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := postJSON(t, srv.URL+"/normalization/lookup", `{"items":["sriracha"]}`)
	defer resp.Body.Close()
	var raw map[string][]map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		t.Fatal(err)
	}
	item := raw["items"][0]
	if _, present := item["shelfLifeDays"]; present {
		t.Fatalf("unknown item carried a shelf life: %+v — never guess", item)
	}
	if item["aisle"] != "other" {
		t.Fatalf("aisle = %v, want other", item["aisle"])
	}
}

func TestNormalizationLookup_CollapsesDuplicates(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := postJSON(t, srv.URL+"/normalization/lookup", `{"items":["milk","Milk","whole milk"]}`)
	defer resp.Body.Close()
	var got struct {
		Items []ItemDetails `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 1 {
		t.Fatalf("got %d items, want 1 deduped: %+v", len(got.Items), got.Items)
	}
}

func TestRecipesUsing_MatchesOwnAndCatalogRecipesRankedByMatchCount(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := t.Context()
	if _, err := store.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Spinach & Egg Scramble", Ingredients: []Ingredient{{Quantity: 2, Item: "spinach"}, {Quantity: 3, Item: "eggs"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast", Ingredients: []Ingredient{{Quantity: 1, Item: "bread"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateRecipe(ctx, CatalogUserID, RecipeInput{Title: "Creamed Spinach", Ingredients: []Ingredient{{Quantity: 1, Item: "spinach"}}}); err != nil {
		t.Fatal(err)
	}

	resp := postJSON(t, srv.URL+"/recipes/using", `{"items":["spinach","egg"]}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got []RecipeMatch
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d matches, want 2 (Toast must not match): %+v", len(got), got)
	}
	if got[0].Title != "Spinach & Egg Scramble" {
		t.Errorf("first = %q, want the 2-match recipe ranked first", got[0].Title)
	}
	if len(got[0].MatchedItems) != 2 {
		t.Errorf("matchedItems = %v, want both", got[0].MatchedItems)
	}
	if got[1].Title != "Creamed Spinach" {
		t.Errorf("second = %q, want the catalog recipe included", got[1].Title)
	}
}

func TestRecipesUsing_DoesNotLeakAnotherUsersRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	if _, err := store.CreateRecipe(t.Context(), "user-b", RecipeInput{Title: "Secret Spinach Pie", Ingredients: []Ingredient{{Quantity: 1, Item: "spinach"}}}); err != nil {
		t.Fatal(err)
	}
	resp := postJSON(t, srv.URL+"/recipes/using", `{"items":["spinach"]}`)
	defer resp.Body.Close()
	var got []RecipeMatch
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("leaked another user's recipes: %+v", got)
	}
}

func TestRecipesUsing_EmptyItemsYieldsEmptyList(t *testing.T) {
	srv, store := newTestServer(t)
	if _, err := store.CreateRecipe(t.Context(), "user-a", RecipeInput{Title: "Toast", Ingredients: []Ingredient{{Quantity: 1, Item: "bread"}}}); err != nil {
		t.Fatal(err)
	}
	resp := postJSON(t, srv.URL+"/recipes/using", `{"items":[]}`)
	defer resp.Body.Close()
	var got []RecipeMatch
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("got %+v, want no matches for no items", got)
	}
}
