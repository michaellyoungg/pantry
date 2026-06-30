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
