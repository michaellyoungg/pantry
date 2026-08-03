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

CREATE INDEX IF NOT EXISTS ingredients_recipe_id_idx ON ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS recipe_steps_recipe_id_idx ON recipe_steps(recipe_id);
CREATE INDEX IF NOT EXISTS recipes_user_id_idx ON recipes(user_id);
