package recipe

import (
	"context"
	"errors"
	"os"
	"testing"
)

// Integration test: requires a reachable Postgres.
// Run with: PANTRY_TEST_DATABASE_URL=postgres://pantry:pantry@localhost:5432/pantry_test go test ./internal/recipe/ -run TestPostgres
func newTestPostgres(t *testing.T) *PostgresStore {
	t.Helper()
	dsn := os.Getenv("PANTRY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set PANTRY_TEST_DATABASE_URL to run Postgres integration tests")
	}
	s, err := NewPostgresStore(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(s.Close)
	// Clean slate.
	if _, err := s.pool.Exec(context.Background(), "TRUNCATE ingredients, recipe_steps, recipes RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return s
}

func TestPostgres_CreateGetListRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	created, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast", Ingredients: []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "bread"},
		{Quantity: 1, Unit: "tbsp", Item: "butter", Note: "softened"},
	}, Steps: []string{"Toast the bread.", "Spread the butter."}})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := s.GetRecipe(ctx, created.ID, "user-a")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Title != "Toast" || len(got.Ingredients) != 2 || got.Ingredients[1].Note != "softened" {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
	if len(got.Steps) != 2 || got.Steps[0] != "Toast the bread." || got.Steps[1] != "Spread the butter." {
		t.Fatalf("steps round-trip mismatch: %+v", got.Steps)
	}

	list, err := s.ListRecipes(ctx, "user-a")
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v / %+v", err, list)
	}
}

func TestPostgres_GetMissingReturnsErrNotFound(t *testing.T) {
	_, err := newTestPostgres(t).GetRecipe(context.Background(), "nope", "user-a")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestPostgres_GetRecipesByIDsPreservesRequestOrder(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)
	a, _ := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "A"})
	b, _ := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "B"})

	got, err := s.GetRecipesByIDs(ctx, "user-a", []string{b.ID, "missing", a.ID})
	if err != nil {
		t.Fatalf("by ids: %v", err)
	}
	if len(got) != 2 || got[0].ID != b.ID || got[1].ID != a.ID {
		t.Fatalf("order/skip wrong: %+v", got)
	}
}

func TestPostgres_DeleteCascadesIngredients(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	rec, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast", Ingredients: []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "bread"},
	}, Steps: []string{"Toast the bread."}})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := s.DeleteRecipe(ctx, rec.ID, "user-a"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.GetRecipe(ctx, rec.ID, "user-a"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete GetRecipe err = %v, want ErrNotFound", err)
	}

	// ingredients and steps are gone via ON DELETE CASCADE
	var n int
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM ingredients WHERE recipe_id = $1", rec.ID).Scan(&n); err != nil {
		t.Fatalf("count ingredients: %v", err)
	}
	if n != 0 {
		t.Fatalf("ingredient rows after delete = %d, want 0", n)
	}
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM recipe_steps WHERE recipe_id = $1", rec.ID).Scan(&n); err != nil {
		t.Fatalf("count steps: %v", err)
	}
	if n != 0 {
		t.Fatalf("step rows after delete = %d, want 0", n)
	}

	if err := s.DeleteRecipe(ctx, "nope", "user-a"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete missing err = %v, want ErrNotFound", err)
	}
}

func TestPostgres_UpdateReplacesIngredients(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	rec, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast", Ingredients: []Ingredient{
		{Quantity: 1, Unit: "slice", Item: "bread"},
	}, Steps: []string{"Toast it."}})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := s.UpdateRecipe(ctx, rec.ID, "user-a", RecipeInput{Title: "French Toast", Ingredients: []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "brioche"},
		{Quantity: 1, Unit: "", Item: "egg"},
	}, Steps: []string{"Soak the brioche.", "Fry both sides."}})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Title != "French Toast" || len(got.Ingredients) != 2 {
		t.Fatalf("update result = %+v, want title+2 ingredients", got)
	}
	if !got.CreatedAt.Equal(rec.CreatedAt) || got.UserID != rec.UserID {
		t.Fatalf("meta changed: %+v vs %+v", got, rec)
	}

	// exactly the new ingredient and step rows persist (old ones replaced)
	reread, err := s.GetRecipe(ctx, rec.ID, "user-a")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(reread.Ingredients) != 2 || reread.Ingredients[0].Item != "brioche" || reread.Ingredients[1].Item != "egg" {
		t.Fatalf("reread ingredients = %+v, want [brioche egg]", reread.Ingredients)
	}
	if len(reread.Steps) != 2 || reread.Steps[0] != "Soak the brioche." || reread.Steps[1] != "Fry both sides." {
		t.Fatalf("reread steps = %+v, want [soak fry]", reread.Steps)
	}

	if _, err := s.UpdateRecipe(ctx, "nope", "user-a", RecipeInput{Title: "X"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("update missing err = %v, want ErrNotFound", err)
	}
}

func TestPostgres_GetRecipe_ScopedToOwner(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)
	rec, _ := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast"})

	if _, err := s.GetRecipe(ctx, rec.ID, "user-a"); err != nil {
		t.Fatalf("owner get: %v", err)
	}
	if _, err := s.GetRecipe(ctx, rec.ID, "user-b"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-owner get: want ErrNotFound, got %v", err)
	}
}

func TestPostgres_DeleteRecipe_ScopedToOwner(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)
	rec, _ := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast"})

	if err := s.DeleteRecipe(ctx, rec.ID, "user-b"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-owner delete: want ErrNotFound, got %v", err)
	}
	// row must survive the non-owner delete
	if _, err := s.GetRecipe(ctx, rec.ID, "user-a"); err != nil {
		t.Fatalf("owner get after non-owner delete: %v", err)
	}
	if err := s.DeleteRecipe(ctx, rec.ID, "user-a"); err != nil {
		t.Fatalf("owner delete: %v", err)
	}
}

func TestPostgres_UpdateRecipe_ScopedToOwner(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)
	rec, _ := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast"})

	if _, err := s.UpdateRecipe(ctx, rec.ID, "user-b", RecipeInput{Title: "Hax"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-owner update: want ErrNotFound, got %v", err)
	}
	// title must be unchanged for the owner
	got, err := s.GetRecipe(ctx, rec.ID, "user-a")
	if err != nil {
		t.Fatalf("owner get: %v", err)
	}
	if got.Title != "Toast" {
		t.Fatalf("title = %q, want Toast (non-owner update must not persist)", got.Title)
	}
}

func TestPostgres_UpsertReplacesAndPreservesCreatedAt(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	rec := Recipe{
		ID: "cat-x", UserID: CatalogUserID, Title: "Cat X",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}},
		Steps:       []string{"Mince the garlic."},
	}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("insert: %v", err)
	}
	first, _ := s.GetRecipe(ctx, rec.ID, CatalogUserID)

	rec.Title = "Cat X v2"
	rec.Ingredients = []Ingredient{{Quantity: 2, Unit: "cloves", Item: "garlic"}, {Quantity: 1, Unit: "loaf", Item: "bread"}}
	rec.Steps = []string{"Slice the bread.", "Add garlic."}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("replace: %v", err)
	}
	got, _ := s.GetRecipe(ctx, rec.ID, CatalogUserID)
	if got.Title != "Cat X v2" || len(got.Ingredients) != 2 {
		t.Fatalf("replace mismatch: %+v", got)
	}
	if len(got.Steps) != 2 || got.Steps[0] != "Slice the bread." {
		t.Fatalf("steps replace mismatch: %+v", got.Steps)
	}
	if !got.CreatedAt.Equal(first.CreatedAt) {
		t.Fatalf("CreatedAt changed: %v vs %v", got.CreatedAt, first.CreatedAt)
	}

	list, _ := s.ListRecipes(ctx, CatalogUserID)
	if len(list) != 1 {
		t.Fatalf("catalog list = %d, want 1", len(list))
	}
}

func TestPostgres_ServingsRoundTripAndClear(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	created, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Chili", Servings: intPtr(6)})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Servings == nil || *created.Servings != 6 {
		t.Fatalf("created servings = %v, want 6", created.Servings)
	}
	got, err := s.GetRecipe(ctx, created.ID, "user-a")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Servings == nil || *got.Servings != 6 {
		t.Fatalf("stored servings = %v, want 6", got.Servings)
	}

	listed, err := s.ListRecipes(ctx, "user-a")
	if err != nil || len(listed) != 1 {
		t.Fatalf("list: %v (%d rows)", err, len(listed))
	}
	if listed[0].Servings == nil || *listed[0].Servings != 6 {
		t.Fatalf("listed servings = %v, want 6", listed[0].Servings)
	}

	// Update replaces the recipe wholesale, so nil clears the stored yield.
	updated, err := s.UpdateRecipe(ctx, created.ID, "user-a", RecipeInput{Title: "Chili"})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Servings != nil {
		t.Fatalf("servings = %d, want nil after clearing", *updated.Servings)
	}
}

// A NULL servings column must scan back as nil, not 0 — the whole point of the
// nullable column is that "unknown" is distinguishable from a real count.
func TestPostgres_NullServingsScansAsNil(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	created, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := s.GetRecipe(ctx, created.ID, "user-a")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Servings != nil {
		t.Fatalf("servings = %d, want nil", *got.Servings)
	}
}

func TestPostgres_UpsertRecipePersistsServings(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	if err := s.UpsertRecipe(ctx, Recipe{ID: "cat-1", UserID: CatalogUserID, Title: "Chili", Servings: intPtr(6)}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	got, err := s.GetRecipe(ctx, "cat-1", CatalogUserID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Servings == nil || *got.Servings != 6 {
		t.Fatalf("servings = %v, want 6", got.Servings)
	}

	// Re-seeding the catalog must carry the new yield through, not keep the old.
	if err := s.UpsertRecipe(ctx, Recipe{ID: "cat-1", UserID: CatalogUserID, Title: "Chili", Servings: intPtr(8)}); err != nil {
		t.Fatalf("re-upsert: %v", err)
	}
	got, _ = s.GetRecipe(ctx, "cat-1", CatalogUserID)
	if got.Servings == nil || *got.Servings != 8 {
		t.Fatalf("servings = %v, want 8 after re-upsert", got.Servings)
	}
}
