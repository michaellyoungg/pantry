package recipe

import (
	"context"
	"errors"
	"testing"
)

func TestMemoryStore_CreateAndGet(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()

	created, err := s.CreateRecipe(ctx, DevUserID, "Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "bread"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected an assigned ID")
	}
	if created.UserID != DevUserID || created.Title != "Toast" {
		t.Fatalf("unexpected recipe: %+v", created)
	}

	got, err := s.GetRecipe(ctx, created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.ID != created.ID || len(got.Ingredients) != 1 {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
}

func TestMemoryStore_GetMissingReturnsErrNotFound(t *testing.T) {
	_, err := NewMemoryStore().GetRecipe(context.Background(), "nope")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestMemoryStore_GetRecipesByIDsPreservesRequestOrderAndSkipsMissing(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
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

func TestMemoryStore_DeleteRemovesRecipe(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	rec, _ := s.CreateRecipe(ctx, DevUserID, "Toast", nil)

	if err := s.DeleteRecipe(ctx, rec.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.GetRecipe(ctx, rec.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete GetRecipe err = %v, want ErrNotFound", err)
	}
	list, _ := s.ListRecipes(ctx, DevUserID)
	if len(list) != 0 {
		t.Fatalf("list after delete = %+v, want empty", list)
	}
}

func TestMemoryStore_DeleteMissingReturnsErrNotFound(t *testing.T) {
	if err := NewMemoryStore().DeleteRecipe(context.Background(), "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestMemoryStore_UpdateReplacesFieldsAndPreservesMeta(t *testing.T) {
	ctx := context.Background()
	s := NewMemoryStore()
	rec, _ := s.CreateRecipe(ctx, DevUserID, "Toast", []Ingredient{
		{Quantity: 1, Unit: "slice", Item: "bread"},
	})

	got, err := s.UpdateRecipe(ctx, rec.ID, "French Toast", []Ingredient{
		{Quantity: 2, Unit: "slices", Item: "brioche"},
		{Quantity: 1, Unit: "", Item: "egg"},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got.Title != "French Toast" {
		t.Fatalf("title = %q, want French Toast", got.Title)
	}
	if len(got.Ingredients) != 2 || got.Ingredients[0].Item != "brioche" {
		t.Fatalf("ingredients = %+v, want replaced", got.Ingredients)
	}
	if got.ID != rec.ID || got.UserID != rec.UserID || !got.CreatedAt.Equal(rec.CreatedAt) {
		t.Fatalf("meta changed: got id=%s user=%s created=%v", got.ID, got.UserID, got.CreatedAt)
	}
	// the stored copy reflects the update
	reread, _ := s.GetRecipe(ctx, rec.ID)
	if reread.Title != "French Toast" || len(reread.Ingredients) != 2 {
		t.Fatalf("reread = %+v, want updated", reread)
	}
}

func TestMemoryStore_UpdateMissingReturnsErrNotFound(t *testing.T) {
	_, err := NewMemoryStore().UpdateRecipe(context.Background(), "nope", "X", nil)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}
