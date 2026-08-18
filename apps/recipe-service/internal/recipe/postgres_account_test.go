package recipe

import (
	"context"
	"testing"
)

// Account deletion (BL-0068) leans entirely on schema.sql's ON DELETE CASCADE:
// DeleteUserRecipes is one statement against `recipes`, and every other table
// that holds a piece of the recipe is expected to follow. That expectation is
// invisible in the Go code, so it is pinned here — a child table added later
// without a cascading foreign key would otherwise leave a user's ingredients,
// steps or prep behind with nothing pointing at them.
func TestPostgres_DeleteUserRecipesCascadesToEveryChildTable(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	rec, err := s.CreateRecipe(ctx, "user-a", RecipeInput{
		Title:       "Pulled Pork",
		Ingredients: []Ingredient{{Quantity: 2, Unit: "kg", Item: "pork shoulder"}},
		Steps:       []string{"Into the slow cooker."},
		Equipment:   []RecipeEquipment{{ID: "slow_cooker", Required: true}},
		Methods:     []string{"slow_cook"},
		Tags:        []string{"comfort"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO recipe_prep_tasks (recipe_id, position, prep_window, text, source)
		 VALUES ($1, 0, $2, $3, 'manual')`,
		rec.ID, string(WindowNightBefore), "Rub the pork"); err != nil {
		t.Fatalf("insert prep task: %v", err)
	}

	deleted, err := s.DeleteUserRecipes(ctx, "user-a")
	if err != nil {
		t.Fatalf("delete user recipes: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}

	for _, table := range []string{
		"recipes", "ingredients", "recipe_steps", "recipe_tags", "recipe_equipment",
		"recipe_methods", "recipe_prep_tasks",
	} {
		var count int
		// Interpolated, not parameterized: a table name cannot be a bind parameter,
		// and the list is this test's own literal.
		if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM `+table).Scan(&count); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if count != 0 {
			t.Errorf("%d rows survived in %s", count, table)
		}
	}

	// Food knowledge is not user data and must survive: the equipment catalog
	// is seeded reference data with no owner.
	var equipment int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM equipment`).Scan(&equipment); err != nil {
		t.Fatalf("count equipment: %v", err)
	}
	if equipment == 0 {
		t.Error("the equipment catalog was deleted along with the user")
	}
}

func TestPostgres_DeleteUserRecipesLeavesOtherOwnersAlone(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	if err := s.UpsertRecipe(ctx, Recipe{ID: "c1", UserID: CatalogUserID, Title: "Weeknight Chili"}); err != nil {
		t.Fatalf("seed catalog: %v", err)
	}
	if _, err := s.CreateRecipe(ctx, "user-b", RecipeInput{Title: "Soup"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.CreateRecipe(ctx, "user-a", RecipeInput{Title: "Toast"}); err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, err := s.DeleteUserRecipes(ctx, "user-a"); err != nil {
		t.Fatalf("delete user recipes: %v", err)
	}

	catalog, err := s.ListRecipes(ctx, CatalogUserID)
	if err != nil || len(catalog) != 1 {
		t.Fatalf("catalog: %v / %+v", err, catalog)
	}
	other, err := s.ListRecipes(ctx, "user-b")
	if err != nil || len(other) != 1 {
		t.Fatalf("user-b: %v / %+v", err, other)
	}
}
