package recipe

import (
	"errors"
	"strings"
	"testing"
)

func TestPostgres_DiscoveryMetadataRoundTrips(t *testing.T) {
	ctx := t.Context()
	s := newTestPostgres(t)

	created, err := s.CreateRecipe(ctx, "user-a", RecipeInput{
		Title:        "Pad Thai",
		Cuisine:      "thai",
		TotalMinutes: intPtr(35),
		Tags:         []string{"weeknight", "gluten-free"},
		SourceURL:    "https://example.com/pad-thai",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := s.GetRecipe(ctx, created.ID, "user-a")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Cuisine != "thai" || got.SourceURL != "https://example.com/pad-thai" {
		t.Errorf("scalars did not round-trip: %+v", got)
	}
	if got.TotalMinutes == nil || *got.TotalMinutes != 35 {
		t.Errorf("totalMinutes = %v, want 35", got.TotalMinutes)
	}
	// Authored order is preserved by the position column, not by chance.
	if strings.Join(got.Tags, ",") != "weeknight,gluten-free" {
		t.Errorf("tags = %v, want [weeknight gluten-free] in that order", got.Tags)
	}
}

func TestPostgres_NullTotalMinutesScansAsNil(t *testing.T) {
	ctx := t.Context()
	s := newTestPostgres(t)
	created, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := s.GetRecipe(ctx, created.ID, "user-a")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.TotalMinutes != nil {
		t.Fatalf("totalMinutes = %d, want nil", *got.TotalMinutes)
	}
	if got.Tags == nil {
		t.Error("tags is nil; the wire contract is []")
	}
}

func TestPostgres_UpdateReplacesDiscoveryTags(t *testing.T) {
	ctx := t.Context()
	s := newTestPostgres(t)
	created, _ := s.CreateRecipe(ctx, "user-a", RecipeInput{
		Title: "Curry", Cuisine: "thai", TotalMinutes: intPtr(40), Tags: []string{"vegan", "spicy"},
	})

	updated, err := s.UpdateRecipe(ctx, created.ID, "user-a", RecipeInput{
		Title: "Curry", Tags: []string{"mild"},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if len(updated.Tags) != 1 || updated.Tags[0] != "mild" {
		t.Errorf("tags = %v, want [mild] — update replaces the set", updated.Tags)
	}
	if updated.Cuisine != "" || updated.TotalMinutes != nil {
		t.Errorf("omitted fields survived: %+v", updated)
	}
}

func TestPostgres_ListLoadsDiscoveryTags(t *testing.T) {
	ctx := t.Context()
	s := newTestPostgres(t)
	if _, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "A", Tags: []string{"vegan"}}); err != nil {
		t.Fatalf("create: %v", err)
	}

	recs, err := s.ListRecipes(ctx, "user-a")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(recs) != 1 || len(recs[0].Tags) != 1 || recs[0].Tags[0] != "vegan" {
		t.Fatalf("list dropped tags: %+v", recs)
	}
}

func TestPostgres_FindCloneOfIsScopedPerUser(t *testing.T) {
	ctx := t.Context()
	s := newTestPostgres(t)

	mine, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Copy", SourceRecipeID: "cat-x"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.CreateRecipe(ctx, "user-b", RecipeInput{Title: "Copy", SourceRecipeID: "cat-x"}); err != nil {
		t.Fatalf("create for user-b: %v", err)
	}

	got, err := s.FindCloneOf(ctx, "user-a", "cat-x")
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if got.ID != mine.ID {
		t.Errorf("found %q, want user-a's own clone %q", got.ID, mine.ID)
	}

	if _, err := s.FindCloneOf(ctx, "user-c", "cat-x"); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound for a user with no clone", err)
	}
}

// Every recipe without provenance stores the empty string in source_recipe_id,
// so a naive lookup would match all of them against each other.
func TestPostgres_FindCloneOfIgnoresRecipesWithoutProvenance(t *testing.T) {
	ctx := t.Context()
	s := newTestPostgres(t)
	if _, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Hand typed"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.FindCloneOf(ctx, "user-a", ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestPostgres_UpdateDoesNotClearProvenance(t *testing.T) {
	ctx := t.Context()
	s := newTestPostgres(t)
	created, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Copy", SourceRecipeID: "cat-x"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	updated, err := s.UpdateRecipe(ctx, created.ID, "user-a", RecipeInput{Title: "Renamed"})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.SourceRecipeID != "cat-x" {
		t.Fatalf("SourceRecipeID = %q after update, want cat-x", updated.SourceRecipeID)
	}
}

// The partial unique index is the database-level backstop for idempotency: two
// concurrent adds must not both succeed.
func TestPostgres_RejectsASecondCloneOfTheSameCatalogRecipe(t *testing.T) {
	ctx := t.Context()
	s := newTestPostgres(t)
	if _, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Copy", SourceRecipeID: "cat-x"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Copy again", SourceRecipeID: "cat-x"}); err == nil {
		t.Fatal("a second clone of the same catalog recipe was allowed")
	}
}

// ...but the index must not stop a user from having many ordinary recipes,
// which all carry the same empty provenance string.
func TestPostgres_AllowsManyRecipesWithoutProvenance(t *testing.T) {
	ctx := t.Context()
	s := newTestPostgres(t)
	for _, title := range []string{"A", "B", "C"} {
		if _, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: title}); err != nil {
			t.Fatalf("create %q: %v", title, err)
		}
	}
}
