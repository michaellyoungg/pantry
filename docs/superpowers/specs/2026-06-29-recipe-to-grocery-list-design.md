# Pantry — Milestone 1 Design: "Walking skeleton: recipe → grocery list"

- **Date:** 2026-06-29
- **Status:** Approved
- **Author:** myoung (with Claude)

## Goal

Build a thin vertical slice that exercises the **whole** hybrid, multi-service
architecture end-to-end. Every service exists and talks to its neighbors, even
if each does just enough. The point is to stand up the real architecture *and*
get something working fast — not to fake the services out.

The working loop:

> Create recipes manually → add them to a meal basket → generate one aggregated
> grocery list → check items off live.

## Non-goals (deliberately backlogged)

- URL import / recipe parsing
- Seeded recipe catalog
- Ingredient normalization, unit conversion, aisle grouping
- Recommendations / preference-lookup
- Real authentication (Convex Auth) — auth is **stubbed** to a fixed dev user
- Production deployment to Railway
- OpenAPI / generated contract types

See [`docs/backlog`](../../backlog) for these items.

## Architecture

A hybrid, multi-service monorepo (Turborepo, `apps/` + `packages/`):

```
                      ┌──────── self-hosted Convex (compose) ────────┐
React (Vite) web ────►│ user · preferences · meal basket ·           │  reactive / websocket
   │                  │ live grocery list · (refs to recipe ids only)│
   │                  └──────────────────────────────────────────────┘
   └────────────────► Go recipe-service ──► Postgres                    plain HTTP
                          canonical recipe definitions + search stub
```

| Component | Tech | Responsibility |
|---|---|---|
| `apps/web` | React + Vite (TS) | UI. Talks to Convex for reactive user data; to recipe-service over HTTP for recipes. |
| `apps/recipe-service` | Go (stdlib; `chi` only if middleware piles up) + Postgres | **Canonical source of truth for recipe definitions.** CRUD, manual entry, search stub, grocery-list aggregation. |
| `convex/` | self-hosted Convex (backend + dashboard) | User-centric reactive data: profile, preferences, meal basket, live grocery list, **references to recipe ids only**. |
| `packages/types` | TypeScript | Shared recipe/ingredient types for web + Convex. Go structs are hand-mirrored (codegen backlogged). |

### Why these boundaries

- **recipe-service is the single source of truth for recipe *definitions*** —
  even a manually-entered recipe is written here and gets a stable id. This is
  the home for the recipe/discovery/recommendations problem space we actually
  want to grow.
- **Convex is user-centric only.** It holds the user, their preferences, the
  meal basket, and the live grocery list, plus **references** to recipe ids
  (with a denormalized title for display). **No recipe bodies live in Convex,
  ever** — the moment they do, this boundary collapses.
- **Multi-tenant from day one.** Every record carries a `user_id`. Auth is
  stubbed to a fixed dev user, with a clean seam for Convex Auth later. The
  expensive part to retrofit (user-scoping) is done now; the cheap part
  (identity) is deferred.

## Data ownership

### recipe-service (Postgres)

- `recipes` — `{ id, user_id, title, created_at, ... }`
- `ingredients` — `{ id, recipe_id, quantity, unit, item, note }`
  - Ingredients are **structured**: `{ quantity, unit, item }` (plus an optional
    free-text `note` like "minced"). This is the shape URL import and the
    normalizer will later produce/consume.

### Convex

- `users` — stubbed dev user for now
- `preferences` — per user (placeholder; populated later)
- `basket` — `{ user_id, recipeId, title }` entries ("what I'm cooking")
- `groceryList` — aggregated lines `{ user_id, item, unit, quantity, checked }`,
  reactive for live check-off

## Core loop & data flow

1. **Create a recipe** (manual entry, structured ingredients) → `POST` to
   recipe-service → returns a recipe id.
2. **Add a recipe to the basket** → Convex stores `{ recipeId, title }`.
3. **Generate the grocery list:**
   - recipe-service exposes an **aggregate endpoint**:
     `POST /grocery-list { recipeIds }` → returns combined ingredient lines.
   - A **Convex action** calls that endpoint with the basket's recipe ids and
     **persists the result as the reactive `groceryList`**.
   - **Check-off is realtime in Convex** — toggling an item updates live across
     devices.

**Why aggregation lives in recipe-service:** aggregation is recipe-domain logic
that will grow the normalization / unit-conversion / aisle-grouping smarts
later. Keeping it in the Go service means those smarts land where the ingredient
data already lives, while reactivity stays in Convex.

## Ingredient & aggregation model

- Each ingredient is `{ quantity, unit, item }`.
- Aggregation is **literal exact-match** on `item` + `unit`:
  - `garlic / cloves` + `garlic / cloves` → quantities summed into one line.
  - `garlic / cloves` + `garlic / grams` → **two** separate lines (no unit
    conversion yet).
- No normalization, synonyms, or aisle grouping in this milestone — all
  backlogged.

## Local development

`docker compose up` runs:

- recipe-service + its Postgres
- Convex backend + Convex dashboard + Convex's Postgres

`npx convex dev` points at the self-hosted Convex instance
(`CONVEX_SELF_HOSTED_URL` + admin key) for codegen and function hot-reload.
`pnpm dev` runs the web app. Turborepo orchestrates the JS tasks and wraps the
Go build as a task.

## Tech stack

- **Package manager:** pnpm
- **Monorepo:** Turborepo (`apps/` + `packages/`)
- **Web:** React + Vite + TypeScript
- **recipe-service:** Go (stdlib `net/http` routing; add `chi` only if
  middleware accumulates) + Postgres
- **Convex:** self-hosted (compose locally; official Railway template in prod,
  later)

## Contract strategy

For this skeleton, the recipe-service HTTP contract is hand-written in two
places: TypeScript types in `packages/types` and mirrored Go structs. This is a
**known drift risk** — flagged, not pretended away. **OpenAPI-driven codegen is
backlogged** to land before the contract grows complex.

## Testing

- Go unit tests on the **aggregation logic** — the one piece with real logic
  worth pinning (exact-match combining, separate-unit splitting).
- A smoke test of the end-to-end loop (create → basket → generate → check off).

## Alternatives considered & deferred

| Decision | Chosen | Alternatives (deferred) | Backlog |
|---|---|---|---|
| Recipe source | Manual entry | URL import; seeded catalog | BL-0001, BL-0002 |
| Aggregation smarts | Literal exact-match | Normalization + unit conversion + aisle grouping | BL-0003 |
| Auth | Stubbed dev user, multi-tenant model | Convex Auth (real login) | BL-0004 |
| Recipe storage | recipe-service is canonical (Convex refs only) | User-authored recipes in Convex (two homes) | — |
| Convex hosting | Self-hosted (compose + Railway) | Convex Cloud managed | — |
| Contract | Hand-written TS + Go | OpenAPI codegen | BL-0007 |
| Deploy | Local-first (compose) | Railway deploy in M1 | BL-0006 |
| Recommendations | Out of scope | Preference-lookup / recommendations service | BL-0005 |
