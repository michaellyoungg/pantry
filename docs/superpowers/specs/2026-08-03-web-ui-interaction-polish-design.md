# BL-0012 — Web UI interaction polish: read-side loading/error states + optimistic gaps

## Context

BL-0012 (written 2026-06-30, against the deliberately-minimal Plan 2b UI) named
three interaction rough edges: grocery check-off flicker, swallowed errors in
`RecipeForm`/`Basket`/`GroceryList`, and the `Catalog` panel conflating
loading / empty / fetch-failure. Intervening work has since resolved most of it:

- **Grocery check-off flicker — already fixed.** `toggleItem` uses
  `useMutation(...).withOptimisticUpdate(toggleItemOptimistic)`
  (`GroceryList.tsx:14`, `optimistic.ts:5`), so the checkbox no longer reverts
  for a beat.
- **Swallowed errors — already fixed.** A shared `useAsyncAction` hook
  (`lib/useAsyncAction.ts`) plus an `ErrorText` component
  (`components/ErrorText.tsx`) now surface rejected mutations/actions inline, and
  are adopted across ~9 components (RecipeForm, WeekPlan/Basket, GroceryList,
  Catalog's `addToBasket`, Pantry, RecipeList, Home/NextAction, AuthForm).

What remains is the **read side**. The write side got a shared primitive
(`useAsyncAction`); the imperative fetch-on-mount loads never did, so two of them
still swallow failures and collapse three distinct states into one:

- `Catalog.tsx:20` — `listCatalog().catch(console.error)`, and `recipes.length
  === 0` renders "No catalog recipes yet." for **loading, genuinely-empty, and
  backend-down alike**. A user whose backend is down sees "no recipes," not an
  error. (This is BL-0012's explicit point #3.)
- `RecipeList.tsx:33` — the identical `listRecipes().catch(console.error)`
  swallow on its own mount load. Same bug, same panel family.

Two mutations also still lack optimistic updates and visibly lag by a round-trip:
`groceryList.needItAnyway` (`GroceryList.tsx:18`) and `basket.add`
(`Catalog.tsx:13`, `RecipeList.tsx:18`).

Scope decision (approved): fix both read-side loads **and** close those two
optimistic gaps.

## Goals

1. No fetch-on-mount load swallows its rejection; failures reach the user.
2. `Catalog` and `RecipeList` visually distinguish **loading**, **empty**, and
   **error** (with retry).
3. `needItAnyway` and `basket.add` respond instantly (optimistic), matching the
   already-optimistic mutations around them.
4. The read side gets a shared primitive so the next fetch-load isn't ad hoc.

Non-goals: converting the imperative `listCatalog`/`listRecipes` **actions** into
reactive Convex queries (a larger architectural change); adding optimistic
updates to the low-flicker, already-error-surfaced basket mutations
(`schedule`/`unschedule`/`setServings`/`setType`/`updateTitle`).

## Design

### 1. `lib/useAsyncData.ts` (new) — the read-side analog of `useAsyncAction`

```
useAsyncData<T>(fn: () => Promise<T>): {
  data: T | undefined;   // undefined until first resolve
  loading: boolean;      // true while a run is in flight (starts true)
  error: string | null;  // normalized via errorMessage(); null on success
  reload: () => void;     // re-run fn (for a Retry button)
}
```

- Runs `fn` on mount and whenever `reload()` is invoked (a bumped counter in the
  dep array). `fn` is captured per-run; callers pass a stable function
  (module-level `listCatalog`/`listRecipes`), so no `fn` identity churn.
- Sets `loading` true before each run, clears `error`, then on settle sets either
  `data` (and `loading=false`) or `error` (and `loading=false`).
- Guards against set-state-after-unmount and React 18 StrictMode double-invoke
  with an `active` flag captured in the effect closure; a stale run's result is
  ignored.
- Reuses `errorMessage()` from `useAsyncAction.ts` for consistent normalization.

Rationale: the codebase already chose "shared primitive, not ad hoc" for the
write side. This is the symmetric choice for reads, and it's what makes the
Catalog and RecipeList fixes one-liners instead of duplicated state machines.

### 2. `Catalog.tsx` — four explicit states

Replace `useState<Recipe[]>([])` + the swallowing `useEffect` with
`const { data, loading, error, reload } = useAsyncData(listCatalog)`. Render:

- `loading` → "Loading catalog…"
- `error` → `<ErrorText message={error} />` + a **Retry** button calling `reload`
- loaded & empty (`data.length === 0`) → the existing "No catalog recipes yet."
- otherwise → the recipe list (unchanged markup)

`addToBasket` error surfacing (already present via `useAsyncAction`) is untouched.

### 3. `RecipeList.tsx` — identical treatment

Same swap for `listRecipes()`: loading / error+retry / empty / list. Preserve the
existing per-row basket and edit behavior (`useAsyncAction` paths) unchanged.

### 4. `optimistic.ts` — two new helpers

- **`needItAnywayOptimistic(store, { id })`** — patch `alreadyHave: false` on the
  matching line in the `groceryList.getGroceryList` cache. Exact mirror of
  `toggleItemOptimistic`; guards `cur === undefined`. Wire at `GroceryList.tsx:18`.
- **`addToBasketOptimistic(store, { recipeId, title })`** — if no row in the
  `basket.list` cache already has `recipeId` (the server mutation is idempotent,
  so a duplicate add is a no-op), append a synthetic row. The row carries the
  known fields (`recipeId`, `title`, `userId`) plus placeholder Convex system
  fields (`_id`, `_creationTime`) that the server confirmation overwrites; it has
  no `weekday`, so it lands on the unscheduled rail — exactly like a real fresh
  add. Guard `cur === undefined`. Wire at `Catalog.tsx:13` and `RecipeList.tsx:18`.

  Fallback: if the synthetic row can't be typed cleanly against the
  `basket.list` element type without unreasonable casting, leave `basket.add`
  non-optimistic — it already surfaces errors — and note it. The `needItAnyway`
  and read-side work do not depend on it.

## Data shapes (verified against current code)

- `basket.add` args: `{ recipeId: string, title: string }`; idempotent (returns
  existing row id if the recipe is already basketed).
- `basket.list` rows: `{ _id, _creationTime, userId, recipeId, title, weekday?,
  slot?, servingsMultiplier?, type? }`.
- `needItAnyway` args: `{ id: Id<"groceryList"> }`.
- `getGroceryList` rows include `alreadyHave?: boolean` and `checked: boolean`.

## Error handling

All user-facing failures route through the existing `ErrorText` component (inline
`role="alert"`, no toast system — consistent with the rest of the app). Read-side
errors additionally offer a Retry (`reload`); the empty and error states are
never conflated.

## Testing

- **`useAsyncData` unit tests:** starts loading; resolves → `data` set,
  `loading=false`, `error=null`; rejects → `error` set, `loading=false`,
  `data=undefined`; `reload()` re-runs and can flip error→data; a result that
  settles after unmount is ignored (no set-state warning).
- **`Catalog` / `RecipeList` component tests** (vitest + Testing Library): mock
  the fetch to (a) pend → shows loading, (b) resolve `[]` → shows empty message,
  (c) resolve non-empty → shows items, (d) reject → shows `ErrorText` and a Retry
  that re-invokes the fetch. Assert the three states are distinguishable (the
  down-backend case must NOT show the empty-state copy).
- **Optimistic helper unit tests** mirroring the existing `optimistic` tests:
  `needItAnywayOptimistic` flips `alreadyHave` on the right line only;
  `addToBasketOptimistic` appends when absent and is a no-op when the recipe is
  already in the basket cache; both no-op when the query is unloaded.

## Alternatives considered

- **Inline `useState`/`useEffect` per component** instead of a shared
  `useAsyncData` — fewer new files, but duplicates a four-state machine across two
  (soon more) panels and diverges from the write-side precedent. Rejected.
- **Convert `listCatalog`/`listRecipes` to reactive Convex queries** — would give
  loading/error handling "for free" via `useQuery`, but they're recipe-service
  actions by design; converting is a larger change than this polish item. Deferred.
- **Skip `basket.add` optimism** — simplest, but the approved scope is to close
  the optimistic gaps; kept as the documented fallback only.
