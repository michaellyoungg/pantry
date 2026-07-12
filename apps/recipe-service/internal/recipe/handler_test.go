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

// authReq builds a request carrying the service secret + dev user id headers.
// Unlike httptest.NewRequest, this uses http.NewRequest because these tests
// exercise a real httptest.Server over the network via http.DefaultClient;
// httptest.NewRequest sets RequestURI, which http.Client rejects
// ("RequestURI can't be set in client requests").
func authReq(method, target string, body io.Reader) *http.Request {
	req, err := http.NewRequest(method, target, body)
	if err != nil {
		panic(err)
	}
	req.Header.Set("X-Service-Secret", testSecret)
	req.Header.Set("X-User-Id", "user-a")
	return req
}

func newTestServer(t *testing.T) (*httptest.Server, Store) {
	t.Helper()
	store := NewMemoryStore()
	srv := httptest.NewServer(NewRouter(store, testSecret))
	t.Cleanup(srv.Close)
	return srv, store
}

func doAuth(t *testing.T, method, url string, body io.Reader) *http.Response {
	t.Helper()
	resp, err := http.DefaultClient.Do(authReq(method, url, body))
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	return resp
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
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", bytes.NewBufferString(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	var got Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.ID == "" || got.UserID != "user-a" || got.Title != "Toast" || len(got.Ingredients) != 1 {
		t.Fatalf("unexpected recipe: %+v", got)
	}
}

func TestCreateRecipe_RejectsEmptyTitle(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", bytes.NewBufferString(`{"title":"","ingredients":[]}`))
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
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", bytes.NewBufferString(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", resp.StatusCode)
	}
}

func TestGetRecipe_NotFound(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodGet, srv.URL+"/recipes/nope", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestListRecipes_ReturnsDevUserRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	_, _ = store.CreateRecipe(context.Background(), "user-a", "A", nil)
	resp := doAuth(t, http.MethodGet, srv.URL+"/recipes", nil)
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
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", bytes.NewBufferString(`{"title":"Plain"}`))
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
	a, _ := store.CreateRecipe(ctx, "user-a", "A", []Ingredient{{Quantity: 2, Unit: "cloves", Item: "garlic"}})
	b, _ := store.CreateRecipe(ctx, "user-a", "B", []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}})

	body, _ := json.Marshal(map[string][]string{"recipeIds": {a.ID, b.ID}})
	resp := doAuth(t, http.MethodPost, srv.URL+"/grocery-list", bytes.NewBuffer(body))
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

func TestDeleteRecipe_RemovesAndReturns204(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(context.Background(), "user-a", "Toast", nil)

	resp := doAuth(t, http.MethodDelete, srv.URL+"/recipes/"+rec.ID, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}
	// gone afterwards
	get := doAuth(t, http.MethodGet, srv.URL+"/recipes/"+rec.ID, nil)
	defer get.Body.Close()
	if get.StatusCode != http.StatusNotFound {
		t.Fatalf("GET after delete = %d, want 404", get.StatusCode)
	}
}

func TestDeleteRecipe_MissingReturns404(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodDelete, srv.URL+"/recipes/nope", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestUpdateRecipe_ReplacesAndReturns200(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(context.Background(), "user-a", "Toast", nil)

	body := bytes.NewBufferString(`{"title":"French Toast","ingredients":[{"quantity":2,"unit":"slices","item":"brioche"}]}`)
	req := authReq(http.MethodPut, srv.URL+"/recipes/"+rec.ID, body)
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
	req := authReq(http.MethodPut, srv.URL+"/recipes/nope", body)
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
	rec, _ := store.CreateRecipe(context.Background(), "user-a", "Toast", nil)
	body := bytes.NewBufferString(`{"title":"   ","ingredients":[]}`)
	req := authReq(http.MethodPut, srv.URL+"/recipes/"+rec.ID, body)
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
