package recipe

import (
	"context"
	"testing"
)

// The recipe_prep_tasks table ships empty (BL-0042) and is filled by BL-0044.
// It is still worth a test: the DDL is only exercised when a Postgres store is
// built, and the column is `prep_window` for a reason — `window` is a reserved
// word and `CREATE TABLE t (window TEXT)` is a syntax error, so a well-meant
// rename would take the entire schema down at service start.
func TestPostgres_PrepTasksTableAcceptsRows(t *testing.T) {
	ctx := context.Background()
	s := newTestPostgres(t)

	rec, err := s.CreateRecipe(ctx, "user-a", "Roast turkey", nil, nil, nil, nil, nil)
	if err != nil {
		t.Fatalf("create recipe: %v", err)
	}

	if _, err := s.pool.Exec(ctx,
		`INSERT INTO recipe_prep_tasks (recipe_id, position, prep_window, text, source)
		 VALUES ($1, 0, $2, $3, 'manual')`,
		rec.ID, string(WindowNightBefore), "Take the turkey out"); err != nil {
		t.Fatalf("insert prep task: %v", err)
	}

	var window, text string
	if err := s.pool.QueryRow(ctx,
		`SELECT prep_window, text FROM recipe_prep_tasks WHERE recipe_id = $1`,
		rec.ID).Scan(&window, &text); err != nil {
		t.Fatalf("read prep task: %v", err)
	}
	if window != string(WindowNightBefore) || text != "Take the turkey out" {
		t.Errorf("row = (%q, %q), want the night-before task back", window, text)
	}

	// Prep belongs to its recipe; a deleted recipe must not leave orphans.
	if err := s.DeleteRecipe(ctx, rec.ID, "user-a"); err != nil {
		t.Fatalf("delete recipe: %v", err)
	}
	var count int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM recipe_prep_tasks WHERE recipe_id = $1`, rec.ID).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Errorf("%d prep rows survived the recipe delete", count)
	}
}
