package recipe

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

// The recipe-service half of account deletion (BL-0068). What matters here is
// the blast radius, not the happy path: a cascade that reaches one row too far
// takes recipes nobody can get back.

func deleteUserRecipesAs(t *testing.T, srvURL, userID string) (*http.Response, int) {
	t.Helper()
	resp := doAuthAs(t, http.MethodDelete, srvURL+"/users/me/recipes", userID, nil)
	t.Cleanup(func() { resp.Body.Close() })
	if resp.StatusCode != http.StatusOK {
		return resp, 0
	}
	var body struct {
		Deleted int `json:"deleted"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return resp, body.Deleted
}

func TestDeleteUserRecipes_RemovesEveryRecipeTheUserOwns(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	if _, err := store.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := store.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Soup"}); err != nil {
		t.Fatalf("create: %v", err)
	}

	resp, deleted := deleteUserRecipesAs(t, srv.URL, "user-a")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if deleted != 2 {
		t.Fatalf("deleted = %d, want 2", deleted)
	}

	left, err := store.ListRecipes(ctx, "user-a")
	if err != nil || len(left) != 0 {
		t.Fatalf("list after delete: %v / %+v", err, left)
	}
}

func TestDeleteUserRecipes_LeavesOtherUsersAlone(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	if _, err := store.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := store.CreateRecipe(ctx, "user-b", RecipeInput{Title: "Soup"}); err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, deleted := deleteUserRecipesAs(t, srv.URL, "user-a"); deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}

	left, err := store.ListRecipes(ctx, "user-b")
	if err != nil || len(left) != 1 || left[0].Title != "Soup" {
		t.Fatalf("user-b's recipes: %v / %+v", err, left)
	}
}

// The catalog is owned by a sentinel user, so a real user's cascade already
// cannot see it. This pins that the sentinel is not merely unlikely to be
// deleted but refused.
func TestDeleteUserRecipes_LeavesTheSharedCatalogAlone(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	if err := store.UpsertRecipe(ctx, Recipe{ID: "c1", UserID: CatalogUserID, Title: "Weeknight Chili"}); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}
	if _, err := store.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast"}); err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, deleted := deleteUserRecipesAs(t, srv.URL, "user-a"); deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}

	catalog, err := store.ListRecipes(ctx, CatalogUserID)
	if err != nil || len(catalog) != 1 {
		t.Fatalf("catalog after a user deletion: %v / %+v", err, catalog)
	}
}

func TestDeleteUserRecipes_RefusesTheCatalogSentinel(t *testing.T) {
	srv, store := newTestServer(t)
	ctx := context.Background()
	if err := store.UpsertRecipe(ctx, Recipe{ID: "c1", UserID: CatalogUserID, Title: "Weeknight Chili"}); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}

	resp, _ := deleteUserRecipesAs(t, srv.URL, CatalogUserID)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", resp.StatusCode)
	}
	catalog, err := store.ListRecipes(ctx, CatalogUserID)
	if err != nil || len(catalog) != 1 {
		t.Fatalf("catalog: %v / %+v", err, catalog)
	}
}

// A user with nothing to delete still has an account to close, and a half-done
// cascade has to be safe to run again.
func TestDeleteUserRecipes_IsIdempotentAndSucceedsOnAnEmptyCorpus(t *testing.T) {
	srv, store := newTestServer(t)
	if _, err := store.CreateRecipe(context.Background(), "user-a", RecipeInput{Title: "Toast"}); err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, deleted := deleteUserRecipesAs(t, srv.URL, "user-a"); deleted != 1 {
		t.Fatalf("first delete = %d, want 1", deleted)
	}
	resp, deleted := deleteUserRecipesAs(t, srv.URL, "user-a")
	if resp.StatusCode != http.StatusOK || deleted != 0 {
		t.Fatalf("second delete = %d/%d, want 200/0", resp.StatusCode, deleted)
	}
}

func TestDeleteUserRecipes_RequiresTheServiceSecret(t *testing.T) {
	srv, _ := newTestServer(t)
	req, err := http.NewRequest(http.MethodDelete, srv.URL+"/users/me/recipes", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("X-User-Id", "user-a")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("DELETE: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}
