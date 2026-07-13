package recipe

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

type PostgresStore struct {
	pool *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, dsn string) (*PostgresStore, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connect pool: %w", err)
	}
	if _, err := pool.Exec(ctx, schemaSQL); err != nil {
		pool.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &PostgresStore{pool: pool}, nil
}

func (s *PostgresStore) Close() { s.pool.Close() }

func (s *PostgresStore) CreateRecipe(ctx context.Context, userID, title string, ings []Ingredient, steps []string) (Recipe, error) {
	ings = normIngredients(ings)
	steps = normSteps(steps)
	id := newID()
	createdAt := time.Now().UTC().Truncate(time.Microsecond)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Recipe{}, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO recipes (id, user_id, title, created_at) VALUES ($1,$2,$3,$4)`,
		id, userID, title, createdAt); err != nil {
		return Recipe{}, err
	}
	if err := insertChildren(ctx, tx, id, ings, steps); err != nil {
		return Recipe{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Recipe{}, err
	}
	return Recipe{ID: id, UserID: userID, Title: title, Ingredients: ings, Steps: steps, CreatedAt: createdAt}, nil
}

func (s *PostgresStore) GetRecipe(ctx context.Context, id, userID string) (Recipe, error) {
	rec := Recipe{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, title, created_at FROM recipes WHERE id = $1 AND user_id = $2`, id, userID).
		Scan(&rec.ID, &rec.UserID, &rec.Title, &rec.CreatedAt)
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
	return rec, nil
}

func (s *PostgresStore) ListRecipes(ctx context.Context, userID string) ([]Recipe, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, title, created_at FROM recipes WHERE user_id = $1 ORDER BY created_at, id`, userID)
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

func (s *PostgresStore) UpdateRecipe(ctx context.Context, id, userID, title string, ings []Ingredient, steps []string) (Recipe, error) {
	ings = normIngredients(ings)
	steps = normSteps(steps)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Recipe{}, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `UPDATE recipes SET title = $1 WHERE id = $2 AND user_id = $3`, title, id, userID)
	if err != nil {
		return Recipe{}, err
	}
	if tag.RowsAffected() == 0 {
		return Recipe{}, ErrNotFound
	}
	if err := replaceChildren(ctx, tx, id, ings, steps); err != nil {
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
	ings := normIngredients(rec.Ingredients)
	steps := normSteps(rec.Steps)
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
		`INSERT INTO recipes (id, user_id, title, created_at) VALUES ($1,$2,$3,$4)
		 ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, title = EXCLUDED.title`,
		rec.ID, rec.UserID, rec.Title, createdAt); err != nil {
		return err
	}
	if err := replaceChildren(ctx, tx, rec.ID, ings, steps); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// replaceChildren clears a recipe's ingredient and step rows, then re-inserts
// them from ings/steps — the write path shared by UpdateRecipe and UpsertRecipe.
func replaceChildren(ctx context.Context, tx pgx.Tx, recipeID string, ings []Ingredient, steps []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM ingredients WHERE recipe_id = $1`, recipeID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM recipe_steps WHERE recipe_id = $1`, recipeID); err != nil {
		return err
	}
	return insertChildren(ctx, tx, recipeID, ings, steps)
}

// insertChildren writes ingredient and step rows for a recipe, preserving order
// via the position column.
func insertChildren(ctx context.Context, tx pgx.Tx, recipeID string, ings []Ingredient, steps []string) error {
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
	return nil
}

func (s *PostgresStore) scanRecipesWithIngredients(ctx context.Context, rows pgx.Rows) ([]Recipe, error) {
	out := []Recipe{}
	for rows.Next() {
		rec := Recipe{}
		if err := rows.Scan(&rec.ID, &rec.UserID, &rec.Title, &rec.CreatedAt); err != nil {
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
