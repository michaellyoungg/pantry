CREATE TABLE IF NOT EXISTS recipes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- Curated hardware catalog (BL-0041). Reference data, not user data: rows are
-- seeded from the embedded equipment.json on every boot.
CREATE TABLE IF NOT EXISTS equipment (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    aliases     TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS recipe_equipment (
    recipe_id    TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    equipment_id TEXT NOT NULL REFERENCES equipment(id),
    required     BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (recipe_id, equipment_id)
);

-- method is one of the closed enum in equipment.json; the service validates it
-- before insert so an open vocabulary can never reach BL-0042's rule matching.
CREATE TABLE IF NOT EXISTS recipe_methods (
    recipe_id   TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    method      TEXT NOT NULL,
    PRIMARY KEY (recipe_id, method)
);

CREATE INDEX IF NOT EXISTS ingredients_recipe_id_idx ON ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS recipe_steps_recipe_id_idx ON recipe_steps(recipe_id);
CREATE INDEX IF NOT EXISTS recipes_user_id_idx ON recipes(user_id);
CREATE INDEX IF NOT EXISTS recipe_equipment_equipment_id_idx ON recipe_equipment(equipment_id);
