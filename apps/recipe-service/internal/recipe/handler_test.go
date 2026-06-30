package recipe

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestServer(t *testing.T) (*httptest.Server, Store) {
	t.Helper()
	store := NewMemoryStore()
	srv := httptest.NewServer(NewRouter(store))
	t.Cleanup(srv.Close)
	return srv, store
}

func TestHealthz(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
}

func TestCreateRecipe_ReturnsCreatedWithDevOwner(t *testing.T) {
	srv, _ := newTestServer(t)
	body := `{"title":"Toast","ingredients":[{"quantity":2,"unit":"slices","item":"bread"}]}`
	resp, err := http.Post(srv.URL+"/recipes", "application/json", bytes.NewBufferString(body))
	if err != nil {
		t.Fatalf("POST /recipes: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	var got Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.ID == "" || got.UserID != DevUserID || got.Title != "Toast" || len(got.Ingredients) != 1 {
		t.Fatalf("unexpected recipe: %+v", got)
	}
}

func TestCreateRecipe_RejectsEmptyTitle(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Post(srv.URL+"/recipes", "application/json",
		bytes.NewBufferString(`{"title":"","ingredients":[]}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestGetRecipe_NotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Get(srv.URL + "/recipes/nope")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestListRecipes_ReturnsDevUserRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	_, _ = store.CreateRecipe(context.Background(), DevUserID, "A", nil)
	resp, err := http.Get(srv.URL + "/recipes")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	var got []Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].Title != "A" {
		t.Fatalf("unexpected list: %+v", got)
	}
}

func TestCreateRecipe_NoIngredientsSerializesAsEmptyArray(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Post(srv.URL+"/recipes", "application/json",
		bytes.NewBufferString(`{"title":"Plain"}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), `"ingredients":[]`) {
		t.Fatalf("body should contain \"ingredients\":[], got: %s", body)
	}
	if strings.Contains(string(body), `"ingredients":null`) {
		t.Fatalf("body must not contain null ingredients, got: %s", body)
	}
}

func TestGroceryList_AggregatesAcrossRecipeIDs(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	a, _ := store.CreateRecipe(ctx, DevUserID, "A", []Ingredient{{Quantity: 2, Unit: "cloves", Item: "garlic"}})
	b, _ := store.CreateRecipe(ctx, DevUserID, "B", []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}})

	body, _ := json.Marshal(map[string][]string{"recipeIds": {a.ID, b.ID}})
	resp, err := http.Post(srv.URL+"/grocery-list", "application/json", bytes.NewBuffer(body))
	if err != nil {
		t.Fatalf("POST /grocery-list: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got []GroceryLine
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := []GroceryLine{{Item: "garlic", Unit: "cloves", Quantity: 3}}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}
