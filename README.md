# Pantry

A unified platform for planning meals, discovering recipes, and shopping smarter.

Pantry helps you collect recipes you want to cook, turn them into a single
aggregated grocery list, and (over time) cook from what you already have on hand
to reduce food waste.

## Status

Early development. The first milestone is a **walking skeleton** of the core
loop: *create recipes → add to a meal basket → generate one aggregated grocery
list → check items off live*. See
[`docs/superpowers/specs`](docs/superpowers/specs) for the current design and
[`docs/backlog`](docs/backlog) for planned future work.

## Architecture (target)

A hybrid, multi-service monorepo:

- **`apps/web`** — React (Vite) web app.
- **`apps/recipe-service`** — Go + Postgres. Canonical source of truth for
  recipe definitions, ingredient data, and grocery-list aggregation.
- **`convex/`** — self-hosted Convex. User-centric reactive data: profile,
  preferences, the meal basket, and the live grocery list. Stores references to
  recipe ids only — never recipe bodies.
- **`packages/*`** — shared TypeScript packages (types, etc.).

Local development runs everything via `docker compose`. Production targets
Railway (self-hosted Convex + Postgres).

## Local development

### Seed the catalog

The shared recipe catalog (system-owned browse-and-pick recipes) is loaded by a
one-shot seed job against the Postgres-backed stack:

```bash
docker compose up -d postgres recipe-service
docker compose run --rm seed
```

Re-running is safe — recipes upsert by stable id. The catalog requires Postgres;
running recipe-service with the in-memory store (no `DATABASE_URL`) has an empty
catalog.
