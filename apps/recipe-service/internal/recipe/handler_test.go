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

func TestCreateRecipe_RejectsOversizedBody(t *testing.T) {
	srv, _ := newTestServer(t)
	// Valid JSON that would be accepted (201) without a cap, but exceeds the
	// server's body limit so it must be rejected with 413.
	huge := strings.Repeat("a", 2<<20) // 2 MiB
	body := `{"title":"` + huge + `","ingredients":[]}`
	resp, err := http.Post(srv.URL+"/recipes", "application/json",
		bytes.NewBufferString(body))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", resp.StatusCode)
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

func TestWithCORS_PreflightReturns204WithHeaders(t *testing.T) {
	h := WithCORS(NewRouter(NewMemoryStore()), "http://localhost:5173")
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)

	req, _ := http.NewRequest(http.MethodOptions, srv.URL+"/recipes", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("Allow-Origin = %q, want the web origin", got)
	}
	for _, m := range []string{"PUT", "DELETE"} {
		if got := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(got, m) {
			t.Fatalf("Access-Control-Allow-Methods = %q, want it to include %s", got, m)
		}
	}
}

func TestDeleteRecipe_RemovesAndReturns204(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(context.Background(), DevUserID, "Toast", nil)

	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/recipes/"+rec.ID, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}
	// gone afterwards
	get, err := http.Get(srv.URL + "/recipes/" + rec.ID)
	if err != nil {
		t.Fatalf("GET after delete: %v", err)
	}
	defer get.Body.Close()
	if get.StatusCode != http.StatusNotFound {
		t.Fatalf("GET after delete = %d, want 404", get.StatusCode)
	}
}

func TestDeleteRecipe_MissingReturns404(t *testing.T) {
	srv, _ := newTestServer(t)
	req, _ := http.NewRequest(http.MethodDelete, srv.URL+"/recipes/nope", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestUpdateRecipe_ReplacesAndReturns200(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(context.Background(), DevUserID, "Toast", nil)

	body := bytes.NewBufferString(`{"title":"French Toast","ingredients":[{"quantity":2,"unit":"slices","item":"brioche"}]}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/recipes/"+rec.ID, body)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Title != "French Toast" || len(got.Ingredients) != 1 || got.Ingredients[0].Item != "brioche" {
		t.Fatalf("body = %+v, want updated title+ingredient", got)
	}
	if got.ID != rec.ID {
		t.Fatalf("ID = %q, want %q", got.ID, rec.ID)
	}
}

func TestUpdateRecipe_MissingReturns404(t *testing.T) {
	srv, _ := newTestServer(t)
	body := bytes.NewBufferString(`{"title":"X","ingredients":[]}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/recipes/nope", body)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestUpdateRecipe_BlankTitleReturns400(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(context.Background(), DevUserID, "Toast", nil)
	body := bytes.NewBufferString(`{"title":"   ","ingredients":[]}`)
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/recipes/"+rec.ID, body)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("PUT: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestWithCORS_NormalRequestCarriesOriginHeader(t *testing.T) {
	h := WithCORS(NewRouter(NewMemoryStore()), "http://localhost:5173")
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)

	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("Allow-Origin = %q, want the web origin", got)
	}
}

func TestListCatalog_ReturnsCatalogOwnedRecipesOnly(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	if err := store.UpsertRecipe(ctx, Recipe{
		ID: "cat-x", UserID: CatalogUserID, Title: "Cat X",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// A dev-user recipe must NOT leak into the catalog.
	_, _ = store.CreateRecipe(ctx, DevUserID, "Mine", nil)

	resp, err := http.Get(srv.URL + "/catalog")
	if err != nil {
		t.Fatalf("GET /catalog: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got []Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].ID != "cat-x" || got[0].UserID != CatalogUserID {
		t.Fatalf("unexpected catalog: %+v", got)
	}
}

func TestListCatalog_EmptySerializesAsEmptyArray(t *testing.T) {
	srv, _ := newTestServer(t)
	resp, err := http.Get(srv.URL + "/catalog")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if strings.TrimSpace(string(body)) != "[]" {
		t.Fatalf("body = %q, want []", body)
	}
}
