package nutrition

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresCache persists the ingredient -> food mapping and the food data behind
// it. The tables live in internal/recipe/schema.sql alongside the recipe tables,
// because the service has one schema-application point; the queries live here,
// with the code that owns them.
//
// FDC data is CC0, so this cache is permanent by design — there is no TTL and no
// eviction. Steady-state traffic to the API approaches zero.
type PostgresCache struct{ pool *pgxpool.Pool }

func NewPostgresCache(pool *pgxpool.Pool) *PostgresCache { return &PostgresCache{pool: pool} }

func (c *PostgresCache) Food(ctx context.Context, canonicalItem string) (Food, bool, error) {
	var (
		food     Food
		reviewed bool
	)
	err := c.pool.QueryRow(ctx,
		`SELECT fdc_id, fdc_description, match_confidence, source, reviewed
		   FROM ingredient_food_map WHERE canonical_item = $1`, canonicalItem).
		Scan(&food.FDCID, &food.Description, &food.MatchConfidence, &food.Source, &reviewed)
	if errors.Is(err, pgx.ErrNoRows) {
		return Food{}, false, nil
	}
	if err != nil {
		return Food{}, false, err
	}
	food.Reviewed = reviewed

	if food.Nutrients, err = c.scanAmounts(ctx,
		`SELECT nutrient_id, amount_per_100g FROM food_nutrients WHERE fdc_id = $1`, food.FDCID); err != nil {
		return Food{}, false, err
	}
	if food.Portions, err = c.scanAmounts(ctx,
		`SELECT portion_key, gram_weight FROM food_portions WHERE fdc_id = $1`, food.FDCID); err != nil {
		return Food{}, false, err
	}
	return food, true, nil
}

func (c *PostgresCache) scanAmounts(ctx context.Context, sql string, fdcID int) (map[string]float64, error) {
	rows, err := c.pool.Query(ctx, sql, fdcID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var k string
		var v float64
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// PutFood writes a mapping and the food behind it.
//
// A row a human has marked `reviewed` is left completely alone. That flag is the
// override point the whole matching strategy rests on: if an automatic lookup
// could quietly undo a correction, correcting a bad match would not stick.
func (c *PostgresCache) PutFood(ctx context.Context, canonicalItem string, food Food) error {
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op

	var reviewed bool
	err = tx.QueryRow(ctx,
		`SELECT reviewed FROM ingredient_food_map WHERE canonical_item = $1`, canonicalItem).Scan(&reviewed)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if reviewed {
		return nil
	}

	source := food.Source
	if source == "" {
		source = SourceFDC
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO ingredient_food_map
		   (canonical_item, fdc_id, fdc_description, match_confidence, source, matched_at)
		 VALUES ($1,$2,$3,$4,$5, now())
		 ON CONFLICT (canonical_item) DO UPDATE SET
		   fdc_id           = EXCLUDED.fdc_id,
		   fdc_description  = EXCLUDED.fdc_description,
		   match_confidence = EXCLUDED.match_confidence,
		   source           = EXCLUDED.source,
		   matched_at       = EXCLUDED.matched_at`,
		canonicalItem, food.FDCID, food.Description, food.MatchConfidence, source); err != nil {
		return err
	}

	for id, amount := range food.Nutrients {
		if _, err := tx.Exec(ctx,
			`INSERT INTO food_nutrients (fdc_id, nutrient_id, amount_per_100g) VALUES ($1,$2,$3)
			 ON CONFLICT (fdc_id, nutrient_id) DO UPDATE SET amount_per_100g = EXCLUDED.amount_per_100g`,
			food.FDCID, id, amount); err != nil {
			return err
		}
	}
	for key, grams := range food.Portions {
		if _, err := tx.Exec(ctx,
			`INSERT INTO food_portions (fdc_id, portion_key, gram_weight) VALUES ($1,$2,$3)
			 ON CONFLICT (fdc_id, portion_key) DO UPDATE SET gram_weight = EXCLUDED.gram_weight`,
			food.FDCID, key, grams); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// SeedNutrients writes the nutrient reference table. The runtime path reads
// units from the embedded snapshot, so this exists to make the stored data
// self-describing for SQL-side inspection and later joins.
func (c *PostgresCache) SeedNutrients(ctx context.Context, nutrients map[string]Nutrient) error {
	for _, n := range nutrients {
		if _, err := c.pool.Exec(ctx,
			`INSERT INTO nutrients (id, name, unit) VALUES ($1,$2,$3)
			 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, unit = EXCLUDED.unit`,
			n.ID, n.Name, n.Unit); err != nil {
			return err
		}
	}
	return nil
}
