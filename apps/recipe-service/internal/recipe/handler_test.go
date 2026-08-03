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

// authReqAs is like authReq but lets the caller choose the X-User-Id, so tests
// can exercise cross-user access with a valid service secret.
func authReqAs(method, target, userID string, body io.Reader) *http.Request {
	req := authReq(method, target, body)
	req.Header.Set("X-User-Id", userID)
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

func doAuthAs(t *testing.T, method, url, userID string, body io.Reader) *http.Response {
	t.Helper()
	resp, err := http.DefaultClient.Do(authReqAs(method, url, userID, body))
	if err != nil {
		t.Fatalf("%s %s as %s: %v", method, url, userID, err)
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

func TestCreateRecipe_ReturnsCreatedWithOwner(t *testing.T) {
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

func TestListRecipes_ReturnsOwnerRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	_, _ = store.CreateRecipe(context.Background(), "user-a", "A", nil, nil, nil)
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
	// Steps follow the same [] (never null) contract as ingredients.
	if !strings.Contains(string(body), `"steps":[]`) {
		t.Fatalf("body should contain \"steps\":[], got: %s", body)
	}
	if strings.Contains(string(body), `"steps":null`) {
		t.Fatalf("body must not contain null steps, got: %s", body)
	}
}

func TestCreateRecipe_PersistsAndReturnsSteps(t *testing.T) {
	srv, _ := newTestServer(t)
	body := `{"title":"Toast","ingredients":[{"quantity":1,"unit":"slice","item":"bread"}],` +
		`"steps":["Toast the bread.","Butter it."]}`
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", bytes.NewBufferString(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	var created Recipe
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(created.Steps) != 2 || created.Steps[0] != "Toast the bread." {
		t.Fatalf("create response steps = %+v, want the two posted steps", created.Steps)
	}

	// Steps survive a GET round-trip in order.
	get := doAuth(t, http.MethodGet, srv.URL+"/recipes/"+created.ID, nil)
	defer get.Body.Close()
	var got Recipe
	if err := json.NewDecoder(get.Body).Decode(&got); err != nil {
		t.Fatalf("decode get: %v", err)
	}
	if len(got.Steps) != 2 || got.Steps[1] != "Butter it." {
		t.Fatalf("get steps = %+v, want [Toast, Butter]", got.Steps)
	}
}

func TestGroceryList_AggregatesAcrossRecipeIDs(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	a, _ := store.CreateRecipe(ctx, "user-a", "A", nil, []Ingredient{{Quantity: 2, Unit: "cloves", Item: "garlic"}}, nil)
	b, _ := store.CreateRecipe(ctx, "user-a", "B", nil, []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}}, nil)

	body, _ := json.Marshal(map[string]any{"items": []map[string]any{
		{"recipeId": a.ID, "multiplier": 1},
		{"recipeId": b.ID, "multiplier": 1},
	}})
	resp := doAuth(t, http.MethodPost, srv.URL+"/grocery-list", bytes.NewBuffer(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got []GroceryLine
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := []GroceryLine{{Item: "Garlic", CanonicalItem: "garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

// Catalog recipes are owned by the sentinel CatalogUserID, but any user can add
// them to their basket from the catalog UI. Aggregation must resolve them, or
// a basket of catalog recipes silently yields an empty grocery list.
func TestGroceryList_IncludesCatalogRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	own, _ := store.CreateRecipe(ctx, "user-a", "Own", nil, []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}}, nil)
	cat, _ := store.CreateRecipe(ctx, CatalogUserID, "Catalog", nil, []Ingredient{{Quantity: 2, Unit: "cloves", Item: "garlic"}}, nil)

	body, _ := json.Marshal(map[string]any{"items": []map[string]any{
		{"recipeId": own.ID, "multiplier": 1},
		{"recipeId": cat.ID, "multiplier": 1},
	}})
	resp := doAuth(t, http.MethodPost, srv.URL+"/grocery-list", bytes.NewBuffer(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got []GroceryLine
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := GroceryLine{Item: "Garlic", CanonicalItem: "garlic", Unit: "cloves", Quantity: 3, Aisle: "produce"}
	if len(got) != 1 || got[0] != want {
		t.Fatalf("got %+v, want [%+v]", got, want)
	}
}

// Resolving catalog recipes must not widen the lookup to every user's recipes.
func TestGroceryList_ExcludesOtherUsersRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	mine, _ := store.CreateRecipe(ctx, "user-a", "Mine", nil, []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}}, nil)
	theirs, _ := store.CreateRecipe(ctx, "user-b", "Theirs", nil, []Ingredient{{Quantity: 5, Unit: "cloves", Item: "garlic"}}, nil)

	body, _ := json.Marshal(map[string]any{"items": []map[string]any{
		{"recipeId": mine.ID, "multiplier": 1},
		{"recipeId": theirs.ID, "multiplier": 1},
	}})
	resp := doAuth(t, http.MethodPost, srv.URL+"/grocery-list", bytes.NewBuffer(body))
	defer resp.Body.Close()
	var got []GroceryLine
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].Quantity != 1 {
		t.Fatalf("other user's recipe leaked: got %+v", got)
	}
}

func TestGroceryList_ScalesByMultiplier(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(context.Background(), "user-a", "Garlic", nil,
		[]Ingredient{{Quantity: 2, Unit: "cloves", Item: "garlic"}}, nil)

	body, _ := json.Marshal(map[string]any{"items": []map[string]any{
		{"recipeId": rec.ID, "multiplier": 2},
	}})
	resp := doAuth(t, http.MethodPost, srv.URL+"/grocery-list", bytes.NewBuffer(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got []GroceryLine
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 || got[0].Quantity != 4 {
		t.Fatalf("want 4 cloves garlic, got %+v", got)
	}
}

func TestDeleteRecipe_RemovesAndReturns204(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(context.Background(), "user-a", "Toast", nil, nil, nil)

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
	rec, _ := store.CreateRecipe(context.Background(), "user-a", "Toast", nil, nil, nil)

	body := bytes.NewBufferString(`{"title":"French Toast","ingredients":[{"quantity":2,"unit":"slices","item":"brioche"}],"steps":["Soak.","Fry."]}`)
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
	if len(got.Steps) != 2 || got.Steps[0] != "Soak." || got.Steps[1] != "Fry." {
		t.Fatalf("body steps = %+v, want [Soak. Fry.]", got.Steps)
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
	rec, _ := store.CreateRecipe(context.Background(), "user-a", "Toast", nil, nil, nil)
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

// TestRecipes_CrossUserReturns404 is the HTTP-layer IDOR regression: a recipe
// owned by user-a must be invisible and immutable to user-b, even though user-b
// carries a valid service secret. Every per-id operation must 404, and user-b's
// list must be empty.
func TestRecipes_CrossUserReturns404(t *testing.T) {
	srv, store := newTestServer(t)
	rec, err := store.CreateRecipe(context.Background(), "user-a", "Toast", nil, nil, nil)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	path := srv.URL + "/recipes/" + rec.ID

	// GET as user-b → 404
	get := doAuthAs(t, http.MethodGet, path, "user-b", nil)
	defer get.Body.Close()
	if get.StatusCode != http.StatusNotFound {
		t.Fatalf("GET as user-b = %d, want 404", get.StatusCode)
	}

	// DELETE as user-b → 404 (and must not remove the row)
	del := doAuthAs(t, http.MethodDelete, path, "user-b", nil)
	defer del.Body.Close()
	if del.StatusCode != http.StatusNotFound {
		t.Fatalf("DELETE as user-b = %d, want 404", del.StatusCode)
	}

	// PUT as user-b → 404
	putBody := bytes.NewBufferString(`{"title":"Hax","ingredients":[]}`)
	putReq := authReqAs(http.MethodPut, path, "user-b", putBody)
	putReq.Header.Set("Content-Type", "application/json")
	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil {
		t.Fatalf("PUT as user-b: %v", err)
	}
	defer putResp.Body.Close()
	if putResp.StatusCode != http.StatusNotFound {
		t.Fatalf("PUT as user-b = %d, want 404", putResp.StatusCode)
	}

	// GET /recipes as user-b → empty list, not user-a's recipe
	list := doAuthAs(t, http.MethodGet, srv.URL+"/recipes", "user-b", nil)
	defer list.Body.Close()
	if list.StatusCode != http.StatusOK {
		t.Fatalf("LIST as user-b = %d, want 200", list.StatusCode)
	}
	var got []Recipe
	if err := json.NewDecoder(list.Body).Decode(&got); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("LIST as user-b = %+v, want empty", got)
	}

	// sanity: the recipe still belongs to user-a (the cross-user delete was a no-op)
	ownerGet := doAuthAs(t, http.MethodGet, path, "user-a", nil)
	defer ownerGet.Body.Close()
	if ownerGet.StatusCode != http.StatusOK {
		t.Fatalf("GET as owner user-a = %d, want 200 (row must survive cross-user delete)", ownerGet.StatusCode)
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
	// A regular user's recipe must NOT leak into the catalog.
	_, _ = store.CreateRecipe(ctx, "user-a", "Mine", nil, nil, nil)

	resp := doAuth(t, http.MethodGet, srv.URL+"/catalog", nil)
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
	resp := doAuth(t, http.MethodGet, srv.URL+"/catalog", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if strings.TrimSpace(string(body)) != "[]" {
		t.Fatalf("body = %q, want []", body)
	}
}

// Catalog recipes are owned by the sentinel CatalogUserID but are visible to,
// and basketable by, every user (see TestGroceryList_IncludesCatalogRecipes).
// That asymmetry is exactly where a delete affordance goes wrong: a user must
// never be able to delete or rename a shared catalog recipe out from under
// everyone else. The user-scoped WHERE clause already enforces it; these pin
// the behaviour so a future "resolve against the catalog too" convenience —
// the fix that was needed for aggregation — is never copied onto the write
// paths, where it would be destructive.
func TestDeleteRecipe_CannotDeleteCatalogRecipe(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	if err := store.UpsertRecipe(ctx, Recipe{
		ID: "cat-x", UserID: CatalogUserID, Title: "Cat X",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}},
	}); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}

	resp := doAuth(t, http.MethodDelete, srv.URL+"/recipes/cat-x", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("DELETE /recipes/cat-x as a regular user = %d, want 404", resp.StatusCode)
	}

	if _, err := store.GetRecipe(ctx, "cat-x", CatalogUserID); err != nil {
		t.Fatalf("catalog recipe must survive a user delete: %v", err)
	}
}

func TestUpdateRecipe_CannotRenameCatalogRecipe(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	if err := store.UpsertRecipe(ctx, Recipe{
		ID: "cat-x", UserID: CatalogUserID, Title: "Cat X",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}},
	}); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}

	body := strings.NewReader(`{"title":"Hijacked","ingredients":[]}`)
	resp := doAuth(t, http.MethodPut, srv.URL+"/recipes/cat-x", body)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("PUT /recipes/cat-x as a regular user = %d, want 404", resp.StatusCode)
	}

	rec, err := store.GetRecipe(ctx, "cat-x", CatalogUserID)
	if err != nil {
		t.Fatalf("catalog recipe must survive a user update: %v", err)
	}
	if rec.Title != "Cat X" || len(rec.Ingredients) != 1 {
		t.Fatalf("catalog recipe was mutated by a non-owner: %+v", rec)
	}
}

func TestCreateRecipe_PersistsServings(t *testing.T) {
	srv, _ := newTestServer(t)
	body := `{"title":"Chili","servings":6,"ingredients":[]}`
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", bytes.NewBufferString(body))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	var got Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Servings == nil || *got.Servings != 6 {
		t.Fatalf("servings = %v, want 6", got.Servings)
	}
}

// Omitting servings is the normal case for manual entry, and it must not fail.
func TestCreateRecipe_OmittedServingsIsUnknown(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/recipes",
		bytes.NewBufferString(`{"title":"Toast","ingredients":[]}`))
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	var got Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Servings != nil {
		t.Fatalf("servings = %d, want nil", *got.Servings)
	}
}

// A stored 0 would divide by zero in every per-serving figure downstream.
func TestCreateRecipe_RejectsNonPositiveServings(t *testing.T) {
	srv, _ := newTestServer(t)
	for _, body := range []string{
		`{"title":"Chili","servings":0,"ingredients":[]}`,
		`{"title":"Chili","servings":-3,"ingredients":[]}`,
		`{"title":"Chili","servings":100000,"ingredients":[]}`,
	} {
		resp := doAuth(t, http.MethodPost, srv.URL+"/recipes", bytes.NewBufferString(body))
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("status = %d, want 400 for %s", resp.StatusCode, body)
		}
		resp.Body.Close()
	}
}

func TestUpdateRecipe_ReplacesServings(t *testing.T) {
	srv, store := newTestServer(t)
	rec, _ := store.CreateRecipe(context.Background(), "user-a", "Chili", intPtr(6), nil, nil)

	body := bytes.NewBufferString(`{"title":"Chili","servings":8,"ingredients":[]}`)
	resp := doAuth(t, http.MethodPut, srv.URL+"/recipes/"+rec.ID, body)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got Recipe
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Servings == nil || *got.Servings != 8 {
		t.Fatalf("servings = %v, want 8", got.Servings)
	}
}
