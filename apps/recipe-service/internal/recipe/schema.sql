CREATE TABLE IF NOT EXISTS recipes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    -- Nullable: NULL means "yield unknown", not "zero". See BL-0035.
    servings    INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- This file is the whole schema and is re-applied on every service start, so
-- columns added after a deployment exists need an idempotent ALTER alongside
-- their CREATE TABLE entry above. There is no migrations tool here yet.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS servings INT;

CREATE TABLE IF NOT EXISTS ingredients (
    id          BIGSERIAL PRIMARY KEY,
    recipe_id   TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position    INT  NOT NULL,
    quantity    DOUBLE PRECISION NOT NULL,
    unit        TEXT NOT NULL,
    item        TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS recipe_steps (
    id          BIGSERIAL PRIMARY KEY,
    recipe_id   TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position    INT  NOT NULL,
    text        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ingredients_recipe_id_idx ON ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS recipe_steps_recipe_id_idx ON recipe_steps(recipe_id);
CREATE INDEX IF NOT EXISTS recipes_user_id_idx ON recipes(user_id);

-- ── Nutrition (BL-0036) ─────────────────────────────────────────────────────
-- Food knowledge, not user data. Keyed on the canonical_item the Normalizer
-- already produces, so nutrition, aisles, and later pricing all join on one
-- identifier. Queried from internal/nutrition; the tables live here because the
-- service has a single schema-application point (NewPostgresStore).
--
-- USDA FoodData Central data is CC0 public domain, so these caches are
-- permanent by design: no TTL, no eviction, and steady-state API traffic
-- approaching zero.

-- Reference data for the nutrients we surface, keyed by FDC nutrient number.
CREATE TABLE IF NOT EXISTS nutrients (
    id    TEXT PRIMARY KEY,          -- "1008" energy, "1003" protein, ...
    name  TEXT NOT NULL,
    unit  TEXT NOT NULL              -- kcal, g, mg
);

-- One row per canonical ingredient. This is the cache AND the override point:
-- a wrong fuzzy match is corrected by editing this row and setting `reviewed`,
-- which automatic refreshes then leave alone.
CREATE TABLE IF NOT EXISTS ingredient_food_map (
    canonical_item   TEXT PRIMARY KEY,
    fdc_id           BIGINT NOT NULL,
    fdc_description  TEXT NOT NULL,
    match_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    source           TEXT NOT NULL DEFAULT 'fdc',   -- 'fdc' | 'snapshot'
    reviewed         BOOLEAN NOT NULL DEFAULT FALSE,
    matched_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The nutrient vector, open by design: a new nutrient is new rows, never a
-- migration.
CREATE TABLE IF NOT EXISTS food_nutrients (
    fdc_id          BIGINT NOT NULL,
    nutrient_id     TEXT NOT NULL,
    amount_per_100g DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (fdc_id, nutrient_id)
);

-- Gram weights per household measure. This is what closes the gap the
-- Normalizer cannot: volume and count to mass.
CREATE TABLE IF NOT EXISTS food_portions (
    fdc_id      BIGINT NOT NULL,
    portion_key TEXT NOT NULL,       -- normalized: cup, tbsp, clove, each, large
    gram_weight DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (fdc_id, portion_key)
);

CREATE INDEX IF NOT EXISTS ingredient_food_map_fdc_id_idx ON ingredient_food_map(fdc_id);
