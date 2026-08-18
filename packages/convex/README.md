# @pantry/convex

Self-hosted Convex backend for Pantry — the user-centric reactive layer.
Stores the meal **basket** (references to recipe ids + denormalized title) and
the live **grocery list**. It stores **no recipe bodies** — recipe definitions
and grocery-list aggregation live in the Go `recipe-service`.

## Local dev setup

The Convex backend + dashboard run as services in the repo-root
`docker-compose.yml`, on the same network as `recipe-service`.

1. **Set the instance secret** (once): in the repo-root `.env`, set
   `CONVEX_INSTANCE_SECRET=$(openssl rand -hex 32)`. (Gitignored.)
2. **Bring up the stack** from the repo root:
   ```bash
   docker compose up -d postgres recipe-service convex-backend convex-dashboard
   ```
   Backend: http://127.0.0.1:3210 · Dashboard: http://localhost:6791
3. **Generate an admin key** and write `packages/convex/.env.local`:
   ```bash
   docker compose exec convex-backend ./generate_admin_key.sh
   ```
   ```
   # packages/convex/.env.local  (gitignored — never commit)
   CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
   CONVEX_SELF_HOSTED_ADMIN_KEY=<paste the key>
   ```
4. **Set the deployment env var the `generateGroceryList` action needs.** The
   action runs *inside* the `convex-backend` container, so it reaches the Go
   service by its compose service name (NOT `localhost`):
   ```bash
   pnpm exec convex env set RECIPE_SERVICE_URL http://recipe-service:8090
   ```
   Confirm with `pnpm exec convex env list`. **This is required** — the action
   throws if `RECIPE_SERVICE_URL` is unset.
5. **Deploy functions + codegen** (run from `packages/convex`):
   ```bash
   pnpm exec convex dev          # watch mode
   pnpm exec convex dev --once   # one-shot push + codegen
   ```

## Functions

- `basket.list` / `basket.add` / `basket.remove` — manage the meal basket (add is idempotent).
- `recipes.generateGroceryList` (action) — reads the basket, asks `recipe-service`
  to aggregate those recipes (`POST /grocery-list`), and persists the result.
- `groceryList.getGroceryList` (query) / `groceryList.toggleItem` (mutation) — read + check off.
- `groceryList.mergeGroceryList` is **internal** (called only by the action).

All functions are scoped to `DEV_USER_ID` ("dev-user") until real auth (see backlog BL-0004).

## Account deletion — read this before adding a table

`account.deleteAccount` (action) erases a user everywhere: it calls
`DELETE /users/me/recipes` on recipe-service first, then runs
`account.purgeUserData` — one internal mutation, so the Convex half is one
transaction. recipe-service goes first because the `users` row is the only
handle anyone has on those Postgres recipes; failing this way round leaves the
account intact and the button retryable, and both halves are idempotent.

Nothing infers which tables hold user data — the cascade in `convex/account.ts`
is written out by hand. **If you add a user-scoped table to `schema.ts`, add it
there.** `account.test.ts` seeds a row in every table the schema declares and
requires the database to be empty afterwards, so a table you forget fails by
name rather than quietly retaining someone's data after they asked you not to.
