package recipe

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"time"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, dsn string) (*PostgresStore, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	// Query spans become children of the HTTP server span, so a slow endpoint
	// shows exactly which statement cost the time. When no tracer provider is
	// installed this resolves to the OTel no-op and costs nothing.
	cfg.ConnConfig.Tracer = otelpgx.NewTracer()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect pool: %w", err)
	}
	if _, err := pool.Exec(ctx, schemaSQL); err != nil {
		pool.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	// The equipment catalog is reference data that ships with the binary, so it
	// is re-seeded on every boot rather than migrated. recipe_equipment has a FK
	// onto it, so this has to happen before any recipe write.
	if err := seedEquipment(ctx, pool); err != nil {
		pool.Close()
		return nil, fmt.Errorf("seed equipment: %w", err)
	}
	return &PostgresStore{pool: pool}, nil
}

func (s *PostgresStore) Close() { s.pool.Close() }

// seedEquipment upserts the embedded catalog. Rows are never deleted here: a
// recipe may still reference an entry that has since been dropped from the
// file, and orphaning that FK is worse than keeping a stale row.
func seedEquipment(ctx context.Context, pool *pgxpool.Pool) error {
	for _, e := range EquipmentList() {
		if _, err := pool.Exec(ctx,
			`INSERT INTO equipment (id, name, category, aliases) VALUES ($1,$2,$3,$4)
			 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, aliases = EXCLUDED.aliases`,
			e.ID, e.Name, e.Category, e.Aliases); err != nil {
			return err
		}
	}
	return nil
}

// recipeColumns is the recipes-table projection every read path shares, so a
// new column is added in one place and scanRecipe stays in step with it.
const recipeColumns = `id, user_id, title, servings, cuisine, total_minutes, source_url, source_recipe_id, created_at`

// scanRecipe reads one recipeColumns row. Child rows (ingredients, steps, tags,
// equipment, methods) are loaded separately.
func scanRecipe(row pgx.Row, rec *Recipe) error {
	return row.Scan(&rec.ID, &rec.UserID, &rec.Title, &rec.Servings,
		&rec.Cuisine, &rec.TotalMinutes, &rec.SourceURL, &rec.SourceRecipeID, &rec.CreatedAt)
}

func (s *PostgresStore) CreateRecipe(ctx context.Context, userID string, in RecipeInput) (Recipe, error) {
	rec := Recipe{
		ID:             newID(),
		UserID:         userID,
		SourceRecipeID: in.SourceRecipeID,
		CreatedAt:      time.Now().UTC().Truncate(time.Microsecond),
	}
	applyInput(&rec, in)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Recipe{}, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO recipes (id, user_id, title, servings, cuisine, total_minutes, source_url, source_recipe_id, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		rec.ID, rec.UserID, rec.Title, rec.Servings, rec.Cuisine, rec.TotalMinutes, rec.SourceURL,
		rec.SourceRecipeID, rec.CreatedAt); err != nil {
		return Recipe{}, err
	}
	if err := insertChildren(ctx, tx, rec.ID, rec.Ingredients, rec.Steps, rec.Equipment, rec.Methods, rec.Tags); err != nil {
		return Recipe{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Recipe{}, err
	}
	return rec, nil
}

func (s *PostgresStore) GetRecipe(ctx context.Context, id, userID string) (Recipe, error) {
	rec := Recipe{}
	err := scanRecipe(s.pool.QueryRow(ctx,
		`SELECT `+recipeColumns+` FROM recipes WHERE id = $1 AND user_id = $2`, id, userID), &rec)
	if errors.Is(err, pgx.ErrNoRows) {
		return Recipe{}, ErrNotFound
	}
	if err != nil {
		return Recipe{}, err
	}
	ings, err := s.ingredientsFor(ctx, id)
	if err != nil {
		return Recipe{}, err
	}
	rec.Ingredients = ings
	steps, err := s.stepsFor(ctx, id)
	if err != nil {
		return Recipe{}, err
	}
	rec.Steps = steps
	if err := s.loadTags(ctx, &rec); err != nil {
		return Recipe{}, err
	}
	return rec, nil
}

func (s *PostgresStore) ListRecipes(ctx context.Context, userID string) ([]Recipe, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+recipeColumns+` FROM recipes WHERE user_id = $1 ORDER BY created_at, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.scanRecipesWithIngredients(ctx, rows)
}

func (s *PostgresStore) DeleteRecipe(ctx context.Context, id, userID string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM recipes WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) FindCloneOf(ctx context.Context, userID, sourceRecipeID string) (Recipe, error) {
	if sourceRecipeID == "" {
		return Recipe{}, ErrNotFound
	}
	rec := Recipe{}
	err := scanRecipe(s.pool.QueryRow(ctx,
		`SELECT `+recipeColumns+` FROM recipes
		 WHERE user_id = $1 AND source_recipe_id = $2 ORDER BY created_at, id LIMIT 1`,
		userID, sourceRecipeID), &rec)
	if errors.Is(err, pgx.ErrNoRows) {
		return Recipe{}, ErrNotFound
	}
	if err != nil {
		return Recipe{}, err
	}
	ings, err := s.ingredientsFor(ctx, rec.ID)
	if err != nil {
		return Recipe{}, err
	}
	rec.Ingredients = ings
	steps, err := s.stepsFor(ctx, rec.ID)
	if err != nil {
		return Recipe{}, err
	}
	rec.Steps = steps
	if err := s.loadTags(ctx, &rec); err != nil {
		return Recipe{}, err
	}
	return rec, nil
}

func (s *PostgresStore) GetRecipesByIDs(ctx context.Context, userID string, ids []string) ([]Recipe, error) {
	out := []Recipe{}
	for _, id := range ids {
		rec, err := s.GetRecipe(ctx, id, userID)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, nil
}

func (s *PostgresStore) UpdateRecipe(ctx context.Context, id, userID string, in RecipeInput) (Recipe, error) {
	next := Recipe{}
	applyInput(&next, in)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Recipe{}, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx,
		`UPDATE recipes SET title = $1, servings = $2, cuisine = $3, total_minutes = $4, source_url = $5
		 WHERE id = $6 AND user_id = $7`,
		next.Title, next.Servings, next.Cuisine, next.TotalMinutes, next.SourceURL, id, userID)
	if err != nil {
		return Recipe{}, err
	}
	if tag.RowsAffected() == 0 {
		return Recipe{}, ErrNotFound
	}
	if err := replaceChildren(ctx, tx, id, next.Ingredients, next.Steps, next.Equipment, next.Methods, next.Tags); err != nil {
		return Recipe{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Recipe{}, err
	}
	return s.GetRecipe(ctx, id, userID)
}

// UpsertRecipe inserts rec, or replaces the row with the same id (title, owner,
// and ingredients). created_at is only written on first insert — ON CONFLICT
// leaves the existing value so catalog ordering stays stable across re-seeds.
func (s *PostgresStore) UpsertRecipe(ctx context.Context, rec Recipe) error {
	if rec.ID == "" {
		return errors.New("upsert: recipe id is required")
	}
	applyInput(&rec, inputFrom(rec))
	createdAt := rec.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC().Truncate(time.Microsecond)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO recipes (id, user_id, title, servings, cuisine, total_minutes, source_url, source_recipe_id, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, title = EXCLUDED.title,
		                                servings = EXCLUDED.servings, cuisine = EXCLUDED.cuisine,
		                                total_minutes = EXCLUDED.total_minutes,
		                                source_url = EXCLUDED.source_url,
		                                source_recipe_id = EXCLUDED.source_recipe_id`,
		rec.ID, rec.UserID, rec.Title, rec.Servings, rec.Cuisine, rec.TotalMinutes, rec.SourceURL,
		rec.SourceRecipeID, createdAt); err != nil {
		return err
	}
	if err := replaceChildren(ctx, tx, rec.ID, rec.Ingredients, rec.Steps, rec.Equipment, rec.Methods, rec.Tags); err != nil {
		return err
	}
	// Per producer, and only for producers the caller actually supplied: a
	// re-seed that carries no prep is saying nothing about prep, not asserting
	// that the recipe has none.
	for source := range prepSourcesIn(rec.PrepTasks) {
		batch := []StoredPrepTask{}
		for _, t := range rec.PrepTasks {
			if t.Source == source {
				batch = append(batch, t)
			}
		}
		if err := replacePrepTasksTx(ctx, tx, rec.ID, source, batch); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// replaceChildren clears a recipe's ingredient, step, equipment, method and tag
// rows, then re-inserts them — the write path shared by UpdateRecipe and
// UpsertRecipe.
func replaceChildren(ctx context.Context, tx pgx.Tx, recipeID string, ings []Ingredient, steps []string, equip []RecipeEquipment, methods []string, tags []string) error {
	for _, table := range []string{"ingredients", "recipe_steps", "recipe_equipment", "recipe_methods", "recipe_tags"} {
		if _, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE recipe_id = $1`, recipeID); err != nil {
			return err
		}
	}
	return insertChildren(ctx, tx, recipeID, ings, steps, equip, methods, tags)
}

// insertChildren writes ingredient, step, equipment, method and tag rows for a
// recipe, preserving ingredient/step/tag order via the position column.
// Equipment and methods are sets, so they carry no position and are read back
// sorted.
func insertChildren(ctx context.Context, tx pgx.Tx, recipeID string, ings []Ingredient, steps []string, equip []RecipeEquipment, methods []string, tags []string) error {
	for i, ing := range ings {
		if _, err := tx.Exec(ctx,
			`INSERT INTO ingredients (recipe_id, position, quantity, unit, item, note)
			 VALUES ($1,$2,$3,$4,$5,$6)`,
			recipeID, i, ing.Quantity, ing.Unit, ing.Item, ing.Note); err != nil {
			return err
		}
	}
	for i, step := range steps {
		if _, err := tx.Exec(ctx,
			`INSERT INTO recipe_steps (recipe_id, position, text) VALUES ($1,$2,$3)`,
			recipeID, i, step); err != nil {
			return err
		}
	}
	for _, e := range equip {
		if _, err := tx.Exec(ctx,
			`INSERT INTO recipe_equipment (recipe_id, equipment_id, required) VALUES ($1,$2,$3)`,
			recipeID, e.ID, e.Required); err != nil {
			return err
		}
	}
	for _, m := range methods {
		if _, err := tx.Exec(ctx,
			`INSERT INTO recipe_methods (recipe_id, method) VALUES ($1,$2)`,
			recipeID, m); err != nil {
			return err
		}
	}
	for i, t := range tags {
		if _, err := tx.Exec(ctx,
			`INSERT INTO recipe_tags (recipe_id, tag, position) VALUES ($1,$2,$3)`,
			recipeID, t, i); err != nil {
			return err
		}
	}
	return nil
}

func (s *PostgresStore) scanRecipesWithIngredients(ctx context.Context, rows pgx.Rows) ([]Recipe, error) {
	out := []Recipe{}
	for rows.Next() {
		rec := Recipe{}
		if err := scanRecipe(rows, &rec); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		ings, err := s.ingredientsFor(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Ingredients = ings
		steps, err := s.stepsFor(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Steps = steps
		if err := s.loadTags(ctx, &out[i]); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *PostgresStore) ingredientsFor(ctx context.Context, recipeID string) ([]Ingredient, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT quantity, unit, item, note FROM ingredients WHERE recipe_id = $1 ORDER BY position`, recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ings := []Ingredient{}
	for rows.Next() {
		var ing Ingredient
		if err := rows.Scan(&ing.Quantity, &ing.Unit, &ing.Item, &ing.Note); err != nil {
			return nil, err
		}
		ings = append(ings, ing)
	}
	return ings, rows.Err()
}

// loadTags fills a recipe's equipment, method and discovery-tag sets, plus its
// stored prep tasks. All are always non-nil so the JSON contract stays []
// rather than null. It is the single hook both read paths go through, which is
// why the prep tasks BL-0044 added need no change to either of them.
func (s *PostgresStore) loadTags(ctx context.Context, rec *Recipe) error {
	equip, err := s.equipmentFor(ctx, rec.ID)
	if err != nil {
		return err
	}
	rec.Equipment = equip
	methods, err := s.methodsFor(ctx, rec.ID)
	if err != nil {
		return err
	}
	rec.Methods = methods
	discoveryTags, err := s.tagsFor(ctx, rec.ID)
	if err != nil {
		return err
	}
	rec.Tags = discoveryTags
	prep, err := s.prepTasksFor(ctx, rec.ID)
	if err != nil {
		return err
	}
	rec.PrepTasks = prep
	return nil
}

func (s *PostgresStore) prepTasksFor(ctx context.Context, recipeID string) ([]StoredPrepTask, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT task_key, prep_window, text, source FROM recipe_prep_tasks
		 WHERE recipe_id = $1 ORDER BY position, id`, recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StoredPrepTask{}
	for rows.Next() {
		var t StoredPrepTask
		if err := rows.Scan(&t.Key, &t.Window, &t.Text, &t.Source); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ReplacePrepTasks swaps out one producer's rows for a recipe, leaving the
// other producer's alone. See the Store interface for why it is scoped by
// source rather than replacing everything the recipe carries.
func (s *PostgresStore) ReplacePrepTasks(ctx context.Context, recipeID, source string, tasks []StoredPrepTask) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// The recipe has to exist: without this the delete-then-insert below is a
	// silent no-op for a bad id, and the caller would be told the write worked.
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT true FROM recipes WHERE id = $1`, recipeID).Scan(&exists); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if err := replacePrepTasksTx(ctx, tx, recipeID, source, tasks); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func replacePrepTasksTx(ctx context.Context, tx pgx.Tx, recipeID, source string, tasks []StoredPrepTask) error {
	if _, err := tx.Exec(ctx,
		`DELETE FROM recipe_prep_tasks WHERE recipe_id = $1 AND source = $2`, recipeID, source); err != nil {
		return err
	}
	for i, t := range tasks {
		if _, err := tx.Exec(ctx,
			`INSERT INTO recipe_prep_tasks (recipe_id, position, prep_window, text, source, task_key)
			 VALUES ($1,$2,$3,$4,$5,$6)
			 ON CONFLICT (recipe_id, source, task_key) DO UPDATE
			 SET position = EXCLUDED.position, prep_window = EXCLUDED.prep_window,
			     text = EXCLUDED.text`,
			recipeID, i, string(t.Window), t.Text, t.Source, t.Key); err != nil {
			return err
		}
	}
	return nil
}

// tagsFor reads a recipe's discovery tags in authored order.
func (s *PostgresStore) tagsFor(ctx context.Context, recipeID string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT tag FROM recipe_tags WHERE recipe_id = $1 ORDER BY position`, recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *PostgresStore) equipmentFor(ctx context.Context, recipeID string) ([]RecipeEquipment, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT equipment_id, required FROM recipe_equipment WHERE recipe_id = $1 ORDER BY equipment_id`, recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RecipeEquipment{}
	for rows.Next() {
		var e RecipeEquipment
		if err := rows.Scan(&e.ID, &e.Required); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *PostgresStore) methodsFor(ctx context.Context, recipeID string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT method FROM recipe_methods WHERE recipe_id = $1`, recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return normMethods(out), nil
}

func (s *PostgresStore) stepsFor(ctx context.Context, recipeID string) ([]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT text FROM recipe_steps WHERE recipe_id = $1 ORDER BY position`, recipeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	steps := []string{}
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			return nil, err
		}
		steps = append(steps, text)
	}
	return steps, rows.Err()
}
