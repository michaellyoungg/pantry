package recipe

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// The discover surface's wire shape. It carries no `generated` sidecar — this
// surface deliberately does not invent recipes (see recommend_discover.go).
type discoverResponse struct {
	Results []struct {
		RecipeID string   `json:"recipeId"`
		Title    string   `json:"title"`
		Source   string   `json:"source"`
		Score    float64  `json:"score"`
		Reasons  []string `json:"reasons"`
	} `json:"results"`
}

func postDiscover(t *testing.T, srv string, body any) (discoverResponse, string) {
	t.Helper()
	buf, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	resp := doAuth(t, http.MethodPost, srv+"/recommendations/discover", bytes.NewReader(buf))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var out discoverResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, raw)
	}
	return out, string(raw)
}

func seedDiscoverCatalog(t *testing.T, store Store, id, title string, items ...string) {
	t.Helper()
	ings := make([]Ingredient, 0, len(items))
	for _, it := range items {
		ings = append(ings, Ingredient{Quantity: 1, Unit: "cup", Item: it})
	}
	if err := store.UpsertRecipe(context.Background(), Recipe{
		ID: id, UserID: CatalogUserID, Title: title, Ingredients: ings,
	}); err != nil {
		t.Fatalf("upsert %s: %v", id, err)
	}
}

func TestDiscoverRanksTheCorpus(t *testing.T) {
	srv, store := newTestServer(t)
	seedDiscoverCatalog(t, store, "cat-a", "Garlic Noodles", "noodles", "garlic", "soy sauce")
	seedDiscoverCatalog(t, store, "cat-b", "Plain Porridge", "oats", "water", "salt")

	out, _ := postDiscover(t, srv.URL, map[string]any{
		"preferences":  map[string]any{"likedItems": []string{"garlic", "soy sauce", "noodles"}},
		"interactions": map[string]any{},
	})

	if len(out.Results) != 2 {
		t.Fatalf("got %d results, want 2: %+v", len(out.Results), out.Results)
	}
	if out.Results[0].Title != "Garlic Noodles" {
		t.Fatalf("first result = %q, want the one built on stated likes", out.Results[0].Title)
	}
}

// SAFETY, and the reason this is a handler test as well as a ranker test: the
// filter has to survive the whole request path, including the canonicalization
// this package does on the way in. "Creamy peanut butter" is not "peanut".
func TestDiscoverNeverSurfacesAnAvoidedIngredient(t *testing.T) {
	srv, store := newTestServer(t)
	seedDiscoverCatalog(t, store, "cat-satay", "Chicken Satay", "chicken", "creamy peanut butter")
	seedDiscoverCatalog(t, store, "cat-safe", "Chicken Rice", "chicken", "rice")

	out, _ := postDiscover(t, srv.URL, map[string]any{
		"preferences": map[string]any{"avoidItems": []string{"peanut"}},
	})

	for _, r := range out.Results {
		if r.RecipeID == "cat-satay" {
			t.Fatalf("an avoided allergen family reached the discover surface: %+v", out.Results)
		}
	}
	if len(out.Results) != 1 {
		t.Fatalf("got %d results, want 1: %+v", len(out.Results), out.Results)
	}
}

// The corpus knows something the caller cannot: which catalog rows this user has
// already cloned. The clone stays (rediscovering your own saved recipe is the
// point); the original goes.
func TestDiscoverDropsTheCatalogOriginalOfAClonedRecipe(t *testing.T) {
	srv, store := newTestServer(t)
	seedDiscoverCatalog(t, store, "cat-orig", "Catalog Chilli", "beans", "chilli", "tomato")

	if err := store.UpsertRecipe(context.Background(), Recipe{
		ID: "mine-1", UserID: "user-a", Title: "My Chilli", SourceRecipeID: "cat-orig",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "can", Item: "beans"}},
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	out, _ := postDiscover(t, srv.URL, map[string]any{})

	ids := make([]string, 0, len(out.Results))
	for _, r := range out.Results {
		ids = append(ids, r.RecipeID)
	}
	if len(ids) != 1 || ids[0] != "mine-1" {
		t.Fatalf("results = %v, want only the user's own clone", ids)
	}
}

func TestClonedOriginalsIsSortedAndDeduplicated(t *testing.T) {
	got := clonedOriginals(map[string]Recipe{
		"a": {ID: "a", SourceRecipeID: "cat-z"},
		"b": {ID: "b", SourceRecipeID: "cat-a"},
		"c": {ID: "c", SourceRecipeID: "cat-a"},
		"d": {ID: "d"},
	})
	if len(got) != 2 || got[0] != "cat-a" || got[1] != "cat-z" {
		t.Fatalf("got %v, want [cat-a cat-z]", got)
	}
}

func TestClonedOriginalsReturnsEmptySliceNotNil(t *testing.T) {
	if got := clonedOriginals(map[string]Recipe{}); got == nil {
		t.Fatal("got nil, want an empty slice")
	}
}

// An empty corpus is an empty ARRAY. A nil Go slice marshals to `null`, and the
// web client's non-nullable types throw on it — this has crashed the app once.
func TestDiscoverEncodesEmptyResultsAsAnArray(t *testing.T) {
	srv, _ := newTestServer(t)
	_, raw := postDiscover(t, srv.URL, map[string]any{})
	if !strings.Contains(raw, `"results":[]`) {
		t.Fatalf("body = %s, want results as []", raw)
	}
	if strings.Contains(raw, "null") {
		t.Fatalf("body contains null: %s", raw)
	}
}

// The endpoint is authenticated exactly like every other one: the shared service
// secret plus a user id. A discovery surface leaking across users is the same
// bug as a recipe list leaking across users.
func TestDiscoverRequiresTheServiceSecret(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Post(srv.URL+"/recommendations/discover", "application/json",
		strings.NewReader("{}"))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestDiscoverRejectsMalformedJSON(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/recommendations/discover",
		strings.NewReader("{nope"))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}
