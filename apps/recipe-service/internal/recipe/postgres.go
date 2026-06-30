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

func (s *PostgresStore) CreateRecipe(ctx context.Context, userID, title string, ings []Ingredient) (Recipe, error) {
	if ings == nil {
		ings = []Ingredient{}
	}
	id := newID()
	createdAt := time.Now().UTC()

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
	for i, ing := range ings {
		if _, err := tx.Exec(ctx,
			`INSERT INTO ingredients (recipe_id, position, quantity, unit, item, note)
			 VALUES ($1,$2,$3,$4,$5,$6)`,
			id, i, ing.Quantity, ing.Unit, ing.Item, ing.Note); err != nil {
			return Recipe{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Recipe{}, err
	}
	return Recipe{ID: id, UserID: userID, Title: title, Ingredients: ings, CreatedAt: createdAt}, nil
}

func (s *PostgresStore) GetRecipe(ctx context.Context, id string) (Recipe, error) {
	rec := Recipe{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, title, created_at FROM recipes WHERE id = $1`, id).
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
	return rec, nil
}

func (s *PostgresStore) ListRecipes(ctx context.Context, userID string) ([]Recipe, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, title, created_at FROM recipes WHERE user_id = $1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.scanRecipesWithIngredients(ctx, rows)
}

func (s *PostgresStore) DeleteRecipe(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM recipes WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) GetRecipesByIDs(ctx context.Context, ids []string) ([]Recipe, error) {
	out := []Recipe{}
	for _, id := range ids {
		rec, err := s.GetRecipe(ctx, id)
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
