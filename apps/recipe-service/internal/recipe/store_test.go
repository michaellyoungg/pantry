package recipe

import (
	"context"
	"errors"
	"testing"
)

func TestMemoryStore_CreateAndGet(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()

	created, err := s.CreateRecipe(ctx, "user-a", "Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "bread"},
	}, []string{"Toast the bread.", "Butter it."}, nil, nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected an assigned ID")
	}
	if created.UserID != "user-a" || created.Title != "Toast" {
		t.Fatalf("unexpected recipe: %+v", created)
	}

	got, err := s.GetRecipe(ctx, created.ID, "user-a")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ID != created.ID || len(got.Ingredients) != 1 {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
	if len(got.Steps) != 2 || got.Steps[0] != "Toast the bread." || got.Steps[1] != "Butter it." {
		t.Fatalf("steps round-trip mismatch: %+v", got.Steps)
	}
}

func TestMemoryStore_GetMissingReturnsErrNotFound(t *testing.T) {
	_, err := NewMemoryStore().GetRecipe(context.Background(), "nope", "user-a")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestMemoryStore_GetRecipesByIDsPreservesRequestOrderAndSkipsMissing(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	a, _ := s.CreateRecipe(ctx, "user-a", "A", nil, nil, nil, nil)
	b, _ := s.CreateRecipe(ctx, "user-a", "B", nil, nil, nil, nil)

	got, err := s.GetRecipesByIDs(ctx, "user-a", []string{b.ID, "missing", a.ID})
	if err != nil {
		t.Fatalf("by ids: %v", err)
	}
	if len(got) != 2 || got[0].ID != b.ID || got[1].ID != a.ID {
		t.Fatalf("order/skip wrong: %+v", got)
	}
}

func TestMemoryStore_DeleteRemovesRecipe(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	rec, _ := s.CreateRecipe(ctx, "user-a", "Toast", nil, nil, nil, nil)

	if err := s.DeleteRecipe(ctx, rec.ID, "user-a"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.GetRecipe(ctx, rec.ID, "user-a"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete GetRecipe err = %v, want ErrNotFound", err)
	}
	list, _ := s.ListRecipes(ctx, "user-a")
	if len(list) != 0 {
		t.Fatalf("list after delete = %+v, want empty", list)
	}
}

func TestMemoryStore_DeleteMissingReturnsErrNotFound(t *testing.T) {
	if err := NewMemoryStore().DeleteRecipe(context.Background(), "nope", "user-a"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestMemoryStore_UpdateReplacesFieldsAndPreservesMeta(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	rec, _ := s.CreateRecipe(ctx, "user-a", "Toast", []Ingredient{
		{Quantity: 1, Unit: "slice", Item: "bread"},
	}, []string{"Toast it."}, nil, nil)

	got, err := s.UpdateRecipe(ctx, rec.ID, "user-a", "French Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "brioche"},
		{Quantity: 1, Unit: "", Item: "egg"},
	}, []string{"Soak the brioche.", "Fry both sides."}, nil, nil)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Title != "French Toast" {
		t.Fatalf("title = %q, want French Toast", got.Title)
	}
	if len(got.Ingredients) != 2 || got.Ingredients[0].Item != "brioche" {
		t.Fatalf("ingredients = %+v, want replaced", got.Ingredients)
	}
	if len(got.Steps) != 2 || got.Steps[0] != "Soak the brioche." {
		t.Fatalf("steps = %+v, want replaced", got.Steps)
	}
	if got.ID != rec.ID || got.UserID != rec.UserID || !got.CreatedAt.Equal(rec.CreatedAt) {
		t.Fatalf("meta changed: got id=%s user=%s created=%v", got.ID, got.UserID, got.CreatedAt)
	}
	// the stored copy reflects the update
	reread, _ := s.GetRecipe(ctx, rec.ID, "user-a")
	if reread.Title != "French Toast" || len(reread.Ingredients) != 2 {
		t.Fatalf("reread = %+v, want updated", reread)
	}
}

func TestMemoryStore_UpdateMissingReturnsErrNotFound(t *testing.T) {
	_, err := NewMemoryStore().UpdateRecipe(context.Background(), "nope", "user-a", "X", nil, nil, nil, nil)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestMemoryStore_GetRecipe_ScopedToOwner(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	rec, _ := s.CreateRecipe(ctx, "user-a", "Toast", nil, nil, nil, nil)

	if _, err := s.GetRecipe(ctx, rec.ID, "user-a"); err != nil {
		t.Fatalf("owner get: %v", err)
	}
	if _, err := s.GetRecipe(ctx, rec.ID, "user-b"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-owner get: want ErrNotFound, got %v", err)
	}
}

func TestMemoryStore_DeleteRecipe_ScopedToOwner(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	rec, _ := s.CreateRecipe(ctx, "user-a", "Toast", nil, nil, nil, nil)

	if err := s.DeleteRecipe(ctx, rec.ID, "user-b"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-owner delete: want ErrNotFound, got %v", err)
	}
	if err := s.DeleteRecipe(ctx, rec.ID, "user-a"); err != nil {
		t.Fatalf("owner delete: %v", err)
	}
}

func TestMemoryStore_UpdateRecipe_ScopedToOwner(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	rec, _ := s.CreateRecipe(ctx, "user-a", "Toast", nil, nil, nil, nil)

	if _, err := s.UpdateRecipe(ctx, rec.ID, "user-b", "Hax", nil, nil, nil, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-owner update: want ErrNotFound, got %v", err)
	}
}

func TestMemoryStore_UpsertInsertsThenReplacesPreservingCreatedAt(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()

	rec := Recipe{
		ID:     "cat-garlic-bread",
		UserID: CatalogUserID,
		Title:  "Garlic Bread",
		Ingredients: []Ingredient{
			{Quantity: 4, Unit: "cloves", Item: "garlic"},
		},
		Steps: []string{"Mince the garlic."},
	}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("insert upsert: %v", err)
	}
	first, err := s.GetRecipe(ctx, rec.ID, CatalogUserID)
	if err != nil {
		t.Fatalf("get after insert: %v", err)
	}
	if first.CreatedAt.IsZero() {
		t.Fatal("expected a stamped CreatedAt on first insert")
	}

	// Re-upsert same id with new title + ingredients.
	rec.Title = "Garlic Bread (v2)"
	rec.Ingredients = []Ingredient{
		{Quantity: 1, Unit: "loaf", Item: "baguette"},
		{Quantity: 6, Unit: "cloves", Item: "garlic"},
	}
	rec.Steps = []string{"Slice the baguette.", "Rub with garlic.", "Bake."}
	if err := s.UpsertRecipe(ctx, rec); err != nil {
		t.Fatalf("replace upsert: %v", err)
	}
	got, err := s.GetRecipe(ctx, rec.ID, CatalogUserID)
	if err != nil {
		t.Fatalf("get after replace: %v", err)
	}
	if got.Title != "Garlic Bread (v2)" || len(got.Ingredients) != 2 || got.Ingredients[0].Item != "baguette" {
		t.Fatalf("replace mismatch: %+v", got)
	}
	if len(got.Steps) != 3 || got.Steps[2] != "Bake." {
		t.Fatalf("steps replace mismatch: %+v", got.Steps)
	}
	if !got.CreatedAt.Equal(first.CreatedAt) {
		t.Fatalf("CreatedAt changed on re-upsert: %v vs %v", got.CreatedAt, first.CreatedAt)
	}

	// Exactly one row, and no duplicate order entry (list returns it once).
	list, _ := s.ListRecipes(ctx, CatalogUserID)
	if len(list) != 1 {
		t.Fatalf("catalog list = %d rows, want 1", len(list))
	}
}

func TestMemoryStore_UpsertRequiresID(t *testing.T) {
	if err := NewMemoryStore().UpsertRecipe(context.Background(), Recipe{UserID: CatalogUserID, Title: "x"}); err == nil {
		t.Fatal("expected an error when id is empty")
	}
}
