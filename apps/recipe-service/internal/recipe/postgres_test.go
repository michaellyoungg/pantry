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
	if _, err := s.pool.Exec(context.Background(), "TRUNCATE ingredients, recipes RESTART IDENTITY CASCADE"); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return s
}

func TestPostgres_CreateGetListRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	created, err := s.CreateRecipe(ctx, DevUserID, "Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "bread"},
		{Quantity: 1, Unit: "tbsp", Item: "butter", Note: "softened"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := s.GetRecipe(ctx, created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Title != "Toast" || len(got.Ingredients) != 2 || got.Ingredients[1].Note != "softened" {
		t.Fatalf("round-trip mismatch: %+v", got)
	}

	list, err := s.ListRecipes(ctx, DevUserID)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v / %+v", err, list)
	}
}

func TestPostgres_GetMissingReturnsErrNotFound(t *testing.T) {
	_, err := newTestPostgres(t).GetRecipe(context.Background(), "nope")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestPostgres_GetRecipesByIDsPreservesRequestOrder(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)
	a, _ := s.CreateRecipe(ctx, DevUserID, "A", nil)
	b, _ := s.CreateRecipe(ctx, DevUserID, "B", nil)

	got, err := s.GetRecipesByIDs(ctx, []string{b.ID, "missing", a.ID})
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

	rec, err := s.CreateRecipe(ctx, DevUserID, "Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "bread"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := s.DeleteRecipe(ctx, rec.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.GetRecipe(ctx, rec.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete GetRecipe err = %v, want ErrNotFound", err)
	}

	// ingredients are gone via ON DELETE CASCADE
	var n int
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM ingredients WHERE recipe_id = $1", rec.ID).Scan(&n); err != nil {
		t.Fatalf("count ingredients: %v", err)
	}
	if n != 0 {
		t.Fatalf("ingredient rows after delete = %d, want 0", n)
	}

	if err := s.DeleteRecipe(ctx, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete missing err = %v, want ErrNotFound", err)
	}
}

func TestPostgres_UpdateReplacesIngredients(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	rec, err := s.CreateRecipe(ctx, DevUserID, "Toast", []Ingredient{
		{Quantity: 1, Unit: "slice", Item: "bread"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := s.UpdateRecipe(ctx, rec.ID, "French Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "brioche"},
		{Quantity: 1, Unit: "", Item: "egg"},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Title != "French Toast" || len(got.Ingredients) != 2 {
		t.Fatalf("update result = %+v, want title+2 ingredients", got)
	}
	if !got.CreatedAt.Equal(rec.CreatedAt) || got.UserID != rec.UserID {
		t.Fatalf("meta changed: %+v vs %+v", got, rec)
	}

	// exactly the new ingredient rows persist (old ones replaced)
	reread, err := s.GetRecipe(ctx, rec.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(reread.Ingredients) != 2 || reread.Ingredients[0].Item != "brioche" || reread.Ingredients[1].Item != "egg" {
		t.Fatalf("reread ingredients = %+v, want [brioche egg]", reread.Ingredients)
	}

	if _, err := s.UpdateRecipe(ctx, "nope", "X", nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("update missing err = %v, want ErrNotFound", err)
	}
}

func TestPostgres_UpsertReplacesAndPreservesCreatedAt(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	rec := Recipe{
		ID: "cat-x", UserID: CatalogUserID, Title: "Cat X",
		Ingredients: []Ingredient{{Quantity: 1, Unit: "cloves", Item: "garlic"}},
	}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("insert: %v", err)
	}
	first, _ := s.GetRecipe(ctx, rec.ID)

	rec.Title = "Cat X v2"
	rec.Ingredients = []Ingredient{{Quantity: 2, Unit: "cloves", Item: "garlic"}, {Quantity: 1, Unit: "loaf", Item: "bread"}}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("replace: %v", err)
	}
	got, _ := s.GetRecipe(ctx, rec.ID)
	if got.Title != "Cat X v2" || len(got.Ingredients) != 2 {
		t.Fatalf("replace mismatch: %+v", got)
	}
	if !got.CreatedAt.Equal(first.CreatedAt) {
		t.Fatalf("CreatedAt changed: %v vs %v", got.CreatedAt, first.CreatedAt)
	}

	list, _ := s.ListRecipes(ctx, CatalogUserID)
	if len(list) != 1 {
		t.Fatalf("catalog list = %d, want 1", len(list))
	}
}
