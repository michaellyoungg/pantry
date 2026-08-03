package recipe

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// seedCatalogRecipe puts a fully-populated recipe in the shared catalog, owned
// by the sentinel catalog user exactly as LoadCatalog would.
func seedCatalogRecipe(t *testing.T, store Store, title string) Recipe {
	t.Helper()
	rec, err := store.CreateRecipe(t.Context(), CatalogUserID, RecipeInput{
		Title:        title,
		Servings:     intPtr(4),
		Ingredients:  []Ingredient{{Quantity: 2, Unit: "cloves", Item: "garlic"}},
		Steps:        []string{"Roast it."},
		Equipment:    []RecipeEquipment{{ID: "oven", Required: true}},
		Methods:      []string{"roast"},
		Cuisine:      "italian",
		TotalMinutes: intPtr(25),
		Tags:         []string{"vegetarian", "weeknight"},
		SourceURL:    "https://example.com/garlic",
	})
	if err != nil {
		t.Fatalf("seed catalog recipe: %v", err)
	}
	return rec
}

func decodeRecipe(t *testing.T, resp *http.Response) Recipe {
	t.Helper()
	defer resp.Body.Close()
	var rec Recipe
	if err := json.NewDecoder(resp.Body).Decode(&rec); err != nil {
		t.Fatalf("decode recipe: %v", err)
	}
	return rec
}

func TestAddFromCatalogClonesIntoTheCallersOwnRecipes(t *testing.T) {
	srv, store := newTestServer(t)
	source := seedCatalogRecipe(t, store, "Garlic Bread")

	resp := doAuth(t, http.MethodPost, srv.URL+"/catalog/"+source.ID+"/add", nil)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", resp.StatusCode)
	}
	clone := decodeRecipe(t, resp)

	if clone.UserID != "user-a" {
		t.Errorf("clone.UserID = %q, want user-a", clone.UserID)
	}
	if clone.ID == source.ID {
		t.Error("clone reuses the catalog id; it must be a new recipe, not a reference")
	}
	if clone.SourceRecipeID != source.ID {
		t.Errorf("clone.SourceRecipeID = %q, want %q", clone.SourceRecipeID, source.ID)
	}
	// Every field has to survive the copy, or the user's version silently
	// differs from the one they browsed.
	if clone.Title != source.Title || clone.Cuisine != source.Cuisine || clone.SourceURL != source.SourceURL {
		t.Errorf("clone lost scalar fields: %+v", clone)
	}
	if clone.Servings == nil || *clone.Servings != 4 {
		t.Errorf("clone.Servings = %v, want 4", clone.Servings)
	}
	if clone.TotalMinutes == nil || *clone.TotalMinutes != 25 {
		t.Errorf("clone.TotalMinutes = %v, want 25", clone.TotalMinutes)
	}
	if len(clone.Ingredients) != 1 || len(clone.Steps) != 1 || len(clone.Equipment) != 1 ||
		len(clone.Methods) != 1 || len(clone.Tags) != 2 {
		t.Errorf("clone lost collections: %+v", clone)
	}
}

// The regression this whole endpoint is written around: catalog recipes are
// owned by a sentinel user, so a lookup scoped to the CALLER finds nothing.
func TestAddFromCatalogFindsRecipesOwnedByTheSentinelUser(t *testing.T) {
	srv, store := newTestServer(t)
	source := seedCatalogRecipe(t, store, "Tomato Soup")

	// Confirm the trap is real: the caller cannot see this recipe as its owner.
	if _, err := store.GetRecipe(t.Context(), source.ID, "user-a"); err == nil {
		t.Fatal("test is not exercising the sentinel-owner case")
	}

	resp := doAuth(t, http.MethodPost, srv.URL+"/catalog/"+source.ID+"/add", nil)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201 — the lookup must be scoped to CatalogUserID", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestAddFromCatalogIsIdempotent(t *testing.T) {
	srv, store := newTestServer(t)
	source := seedCatalogRecipe(t, store, "Caesar Salad")

	first := decodeRecipe(t, doAuth(t, http.MethodPost, srv.URL+"/catalog/"+source.ID+"/add", nil))

	resp := doAuth(t, http.MethodPost, srv.URL+"/catalog/"+source.ID+"/add", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("second add status = %d, want 200 (already had a copy)", resp.StatusCode)
	}
	second := decodeRecipe(t, resp)
	if second.ID != first.ID {
		t.Errorf("second add produced a new recipe %q; want the existing %q", second.ID, first.ID)
	}

	mine, err := store.ListRecipes(t.Context(), "user-a")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(mine) != 1 {
		t.Errorf("user has %d recipes after adding twice, want 1", len(mine))
	}
}

// The point of cloning rather than referencing (UX plan decision #6).
func TestEditingACloneDoesNotMutateTheCatalog(t *testing.T) {
	srv, store := newTestServer(t)
	source := seedCatalogRecipe(t, store, "Margherita Pizza")
	clone := decodeRecipe(t, doAuth(t, http.MethodPost, srv.URL+"/catalog/"+source.ID+"/add", nil))

	body := `{"title":"My Pizza","ingredients":[{"quantity":1,"unit":"","item":"dough"}],"cuisine":"american"}`
	resp := doAuth(t, http.MethodPut, srv.URL+"/recipes/"+clone.ID, strings.NewReader(body))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update clone: status %d", resp.StatusCode)
	}
	resp.Body.Close()

	unchanged, err := store.GetRecipe(t.Context(), source.ID, CatalogUserID)
	if err != nil {
		t.Fatalf("re-read catalog recipe: %v", err)
	}
	if unchanged.Title != "Margherita Pizza" || unchanged.Cuisine != "italian" {
		t.Errorf("editing a clone mutated the shared catalog: %+v", unchanged)
	}
}

// Provenance has to outlive an edit, or the second "add" makes a duplicate.
func TestEditingACloneKeepsItsProvenance(t *testing.T) {
	srv, store := newTestServer(t)
	source := seedCatalogRecipe(t, store, "Aglio e Olio")
	clone := decodeRecipe(t, doAuth(t, http.MethodPost, srv.URL+"/catalog/"+source.ID+"/add", nil))

	body := `{"title":"Renamed","ingredients":[{"quantity":1,"unit":"","item":"pasta"}]}`
	resp := doAuth(t, http.MethodPut, srv.URL+"/recipes/"+clone.ID, strings.NewReader(body))
	resp.Body.Close()

	after, err := store.GetRecipe(t.Context(), clone.ID, "user-a")
	if err != nil {
		t.Fatalf("re-read clone: %v", err)
	}
	if after.SourceRecipeID != source.ID {
		t.Fatalf("SourceRecipeID = %q after an edit, want %q", after.SourceRecipeID, source.ID)
	}

	again := doAuth(t, http.MethodPost, srv.URL+"/catalog/"+source.ID+"/add", nil)
	if again.StatusCode != http.StatusOK {
		t.Errorf("re-adding after an edit made a new copy (status %d)", again.StatusCode)
	}
	again.Body.Close()
}

func TestAddFromCatalogGivesEachUserTheirOwnCopy(t *testing.T) {
	srv, store := newTestServer(t)
	source := seedCatalogRecipe(t, store, "Roasted Vegetables")

	a := decodeRecipe(t, doAuthAs(t, http.MethodPost, srv.URL+"/catalog/"+source.ID+"/add", "user-a", nil))
	b := decodeRecipe(t, doAuthAs(t, http.MethodPost, srv.URL+"/catalog/"+source.ID+"/add", "user-b", nil))

	if a.ID == b.ID {
		t.Fatal("two users share one clone; idempotency must be per-user")
	}
	if a.UserID != "user-a" || b.UserID != "user-b" {
		t.Errorf("clone ownership wrong: %q / %q", a.UserID, b.UserID)
	}
}

func TestAddFromCatalogRejectsANonCatalogRecipe(t *testing.T) {
	srv, store := newTestServer(t)
	// A recipe owned by another ordinary user must not be clonable through the
	// catalog route — that would be a cross-tenant read.
	theirs, err := store.CreateRecipe(t.Context(), "user-b", RecipeInput{Title: "Private"})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	resp := doAuth(t, http.MethodPost, srv.URL+"/catalog/"+theirs.ID+"/add", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}

func TestAddFromCatalogUnknownIDIs404(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := doAuth(t, http.MethodPost, srv.URL+"/catalog/nope/add", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
}
