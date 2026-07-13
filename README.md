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

## Testing

### Unit tests

Fast, hermetic, no external services. Run in CI on every push/PR.

```bash
pnpm test            # all workspaces (web, convex, go)
```

- **web** — Vitest + jsdom (components + lib).
- **convex** — `convex-test` runs functions against an in-memory backend.
- **recipe-service** — `go test ./...` (DB-backed tests skip without a database).

### Integration tests

Verify the seams **between** services with no mocks:

- **recipe-service ⇄ Postgres** (`postgres_test.go`) — the real DB code path.
- **Convex actions ⇄ recipe-service ⇄ Postgres** (`recipes.integration.test.ts`)
  — the Convex actions in `packages/convex/convex/recipes.ts` make genuine HTTP
  calls (paths, `X-Service-Secret`/`X-User-Id` headers, JSON shapes) to a real
  running recipe-service. Catches contract drift the unit suites can't.

Run the full suite against a real Postgres (needs Docker + Go):

```bash
pnpm test:integration
```

This starts the compose Postgres, creates a dedicated `pantry_test` database
(never touches dev `pantry`), runs the Go DB tests, then runs the Convex
contract tests against a freshly built recipe-service.

Just the cross-service contract, **no infrastructure** (the service falls back to
its in-memory store when no database is set):

```bash
pnpm --filter @pantry/convex test:integration
```

In CI, the `go` and `integration` jobs run these against a Postgres service
container on every push/PR — so CI and local verify the same seams.

### End-to-end (browser)

The full user loop, driven in a real browser (Playwright) against a complete
compose-up stack — *sign up → create a recipe → plan a day → generate the
aggregated grocery list → check an item off → reload persists*. This catches
cross-service regressions the unit + integration suites can't: Convex Auth over
the self-hosted backend, Convex reactivity, the Convex→recipe-service HTTP
aggregation, and the controlled-checkbox round-trip.

```bash
# once, to install the browser + its OS deps:
pnpm --filter @pantry/web exec playwright install --with-deps chromium
# then, from the repo root:
pnpm test:e2e
```

`pnpm test:e2e` runs [`scripts/e2e.sh`](scripts/e2e.sh), which brings up the
stack, provisions the Convex deployment (admin key, auth JWT keys, recipe-service
wiring), pushes the Convex functions, and then runs Playwright — which starts the
Vite dev server itself. Each run signs up a fresh unique account, so it is
self-isolating. It is **deliberately not part of `pnpm test`** (which stays
unit-only and fast) or the per-PR CI gate — it needs Docker, Go, and a browser.
Set `E2E_KEEP_STACK=1` to leave the stack up for debugging; pass extra flags
through to Playwright, e.g. `pnpm test:e2e --headed`.
