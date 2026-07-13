# Real authentication (Convex Auth) — design

- **Backlog item:** BL-0004
- **Date:** 2026-07-12
- **Area:** auth
- **Status:** approved

## Goal

Replace the stubbed fixed identity (`DEV_USER_ID` / `DevUserID`) with real
per-user sessions. Add login/signup UI, propagate the authenticated user id to
the Go recipe-service, and close the ownership gaps (IDOR) that the stub was
hiding.

## Identity model & trust boundaries

- **Convex Auth (Password provider)** is the single identity authority. The
  browser authenticates only to Convex and holds a Convex session. It never
  holds a service secret and never calls the Go recipe-service directly.
- **The Go recipe-service trusts only Convex**, proven by a shared
  `RECIPE_SERVICE_SECRET`. Every route except `/healthz` requires the secret and
  takes `userId` from the request.
- Trust chain: `browser --Convex session--> Convex --secret + userId--> Go`.

This mirrors the pattern that already exists for `generateGroceryList`, which
proxies browser → Convex → Go. Recipe CRUD is migrated onto the same path
instead of introducing a second trust mechanism (e.g. JWT verification in Go).

### Why proxy-through-Convex over Go-verifies-JWT

Recipe CRUD is low-frequency, human-triggered traffic, so the extra
browser→Convex→Go hop costs a few milliseconds on operations a person performs
by hand — negligible at this app's scale. The alternative (Go verifies the
Convex Auth JWT via JWKS) would give Go a full JWT-verification layer *and*
still need the shared-secret path for the server-to-server grocery-list call —
two trust mechanisms instead of one. Proxying keeps Go with exactly one rule:
"only Convex may call me, proven by a shared secret." If recipe traffic ever
becomes machine-driven and high-volume, switching Go to direct JWT verification
is a contained later change.

## Convex changes (`packages/convex`)

- Add `@convex-dev/auth`:
  - `convex/auth.ts` — Password provider, **no email verification** (keeps the
    app fully local/offline; no email provider dependency).
  - `convex/http.ts` — auth HTTP routes.
  - `convex/schema.ts` — spread `...authTables` (adds a `users` table and
    auth-related tables). Existing `userId` columns stay `v.string()` and store
    the authenticated user id — no schema churn on `basket` / `groceryList` /
    `preferences`.
- Delete `convex/constants.ts` (`DEV_USER_ID`).
- Every query/mutation resolves identity via `getAuthUserId(ctx)` and throws if
  unauthenticated:
  - `basket.ts` — `list`, `add`, `remove`, `updateTitle`.
  - `groceryList.ts` — `getGroceryList`, `replaceGroceryList`, `clearGroceryList`.
- **New recipe CRUD actions** in `recipes.ts` that proxy to Go, forwarding
  `RECIPE_SERVICE_SECRET` (header) + `userId`:
  - `create`, `list`, `get`, `remove`, `update`.
- `generateGroceryList` action gains the `RECIPE_SERVICE_SECRET` header and
  forwards `userId` to Go `/grocery-list`.
- **IDOR fix:** `toggleItem` loads the target row and verifies its `userId`
  matches the caller before patching; throws otherwise.

## Go recipe-service changes (`apps/recipe-service`)

- **Auth middleware:** reject any non-`/healthz` request that lacks the correct
  `RECIPE_SERVICE_SECRET` (401/403). Handlers read `userId` from a request
  header (e.g. `X-User-Id`) instead of `DevUserID`.
- **Close the Go-layer IDOR:** add `userID` scoping to the store methods that
  currently ignore it, so a caller can only touch their own rows:
  - `Store` interface: `GetRecipe`, `DeleteRecipe`, `UpdateRecipe` gain a
    `userID` parameter.
  - `MemoryStore` and `PostgresStore` implementations updated to filter by
    `userID` (return `ErrNotFound` when the row exists but belongs to another
    user).
  - Handlers pass the request's `userId` through.
- Delete the `DevUserID` constant (`types.go`).
- Drop `WithCORS` / `WEB_ORIGIN` from `main.go` and `handler.go` — the browser
  no longer calls Go directly, so no browser-origin CORS is needed.

## Web changes (`apps/web`)

- `src/main.tsx`: swap `ConvexProvider` → `ConvexAuthProvider`.
- Gate the app on auth state:
  - `<Unauthenticated>` renders an email + password **AuthForm** with a
    sign in / sign up toggle.
  - `<Authenticated>` renders the current app, plus a **sign-out** control in
    the header.
- `src/lib/recipeService.ts` stops using `fetch`. Recipe CRUD moves to Convex
  action/mutation hooks. Consumers rewire to those hooks:
  - `RecipeForm`, `RecipeList`, `RecipeEditDialog`.

## Testing

- **Go:**
  - Middleware rejects requests with a missing/incorrect secret; allows
    `/healthz` without it.
  - `GetRecipe` / `DeleteRecipe` / `UpdateRecipe` refuse another user's rows
    (new ownership tests).
  - Existing tests updated off the removed `DevUserID` constant.
- **Convex:**
  - `toggleItem` rejects a non-owner.
  - Auth-required functions throw when unauthenticated.
- **Web:**
  - AuthForm renders and gates the app (unauthenticated shows the form,
    authenticated shows the app).
  - Existing component tests updated for the Convex-hook recipe path.

## Decisions & assumptions

1. **Sign-in method:** email + password (Convex Auth Password provider). No
   third-party OAuth app or email provider to configure; works fully offline.
2. **Existing `dev-user` data is disposable** — no migration. After this lands,
   users sign up fresh. (It is seeded dev data.)
3. **No email verification / password reset** in this item (YAGNI; avoids an
   email-provider dependency). Candidate for a follow-up backlog item.

## Out of scope

- OAuth / magic-link / passwordless sign-in.
- Email verification, password reset, account recovery.
- Migrating existing `dev-user` rows to a real account.
- Go direct JWT verification (revisit only if recipe traffic becomes
  high-volume / machine-driven).
