# Web UI Interaction Polish Design Spec

> Backlog: [BL-0012](../../backlog/BL-0012-web-ui-interaction-polish.md) — web UI
> interaction polish (optimistic updates + error surfacing).

## Goal

Eliminate the grocery check-off flicker and replace silent failures with inline
per-panel error messages, across `RecipeForm`, `Basket`, `GroceryList`, and
`RecipeList`.

## Context

Plan 2b shipped a deliberately-minimal functional UI. Two rough edges remain:
- **Grocery check-off flicker.** `GroceryList`'s checkbox is controlled
  (`checked={line.checked}`) with no optimistic update, so a toggle visibly
  reverts for a beat until the Convex `toggleItem` mutation round-trips.
- **Swallowed errors.** `RecipeForm` create, `Basket` Generate, and
  `GroceryList` toggle drop their promise rejections; `RecipeList` delete/edit
  `console.error`. If recipe-service or Convex is down, the user sees nothing.

The web app currently has **no DOM test environment** — the only test
(`lib/recipeService.test.ts`) stubs `fetch` in vitest's default node env. This
spec adds jsdom + Testing Library so the new stateful units are testable.

## Decisions

- **Both halves** of BL-0012: optimistic updates AND error surfacing.
- **Error surfacing via a reusable `useAsyncAction` hook** — one tested unit,
  consistent UX, DRY across ~5 call sites.
- **Optimistic updates for `groceryList.toggleItem` and `basket.remove` only.**
  `basket.add` stays non-optimistic (optimistic insert needs a fabricated
  Convex `_id`; fragile for little gain — add already feels instant).
- **Add jsdom + @testing-library/react** as dev-deps + a vitest config, so the
  hook, the optimistic updaters, and a representative component can be tested.

## Section 1 — Error handling: `useAsyncAction` hook

New `apps/web/src/lib/useAsyncAction.ts`:
```ts
export function useAsyncAction(): {
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  error: string | null;
  pending: boolean;
  clearError: () => void;
};
```
- `run` sets `pending = true`, clears any prior error, awaits `fn()`. On success
  returns the resolved value and leaves `error` null. On rejection it stores a
  message (via `errorMessage`), leaves `pending = false`, and returns
  `undefined` — so callers can gate post-success work:
  `if (await run(() => createRecipe(...)) !== undefined) resetForm();`
  (Use `!== undefined` rather than truthiness, since a resolved value may be
  falsy; the void-returning calls like delete/toggle ignore the return.)
- `pending` is always reset in a `finally`.
- `clearError` lets a panel dismiss a stale error (e.g. on a fresh edit-dialog
  open). 

New pure helper in the same file (exported for direct testing):
```ts
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
```

New `apps/web/src/components/ErrorText.tsx` — a trivial presentational unit:
```tsx
export function ErrorText({ message }: { message: string | null }) {
  return message ? <p className="error" role="alert">{message}</p> : null;
}
```
Add an `.error` rule (red text, small) to `apps/web/src/App.css` (the existing
global stylesheet, imported in `main.tsx`, where `.panel` is defined).

## Section 2 — Optimistic updates

New `apps/web/src/lib/optimistic.ts` exporting two Convex
`withOptimisticUpdate` updater functions:

```ts
import type { OptimisticLocalStore } from "convex/browser";
import { api } from "@pantry/convex/api";

export function toggleItemOptimistic(
  localStore: OptimisticLocalStore,
  args: { id: string; checked: boolean },
) {
  const cur = localStore.getQuery(api.groceryList.getGroceryList, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.groceryList.getGroceryList,
    {},
    cur.map((l) => (l._id === args.id ? { ...l, checked: args.checked } : l)),
  );
}

export function removeFromBasketOptimistic(
  localStore: OptimisticLocalStore,
  args: { recipeId: string },
) {
  const cur = localStore.getQuery(api.basket.list, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.basket.list,
    {},
    cur.filter((b) => b.recipeId !== args.recipeId),
  );
}
```
- `toggleItemOptimistic` → wired into `GroceryList`'s
  `useMutation(api.groceryList.toggleItem).withOptimisticUpdate(...)`.
- `removeFromBasketOptimistic` → wired into **both** `useMutation(api.basket.remove)`
  call sites (Basket's Remove button and RecipeList's delete flow) so both drop
  the row instantly. Shared updater = no duplication.

The exact arg types (`id` as a Convex `Id<"groceryList">`, etc.) follow what the
mutations already declare; the implementation plan will use the precise generated
types. Convex auto-rolls-back the optimistic edit if the server mutation
rejects, and `useAsyncAction.run` surfaces that rejection — the two halves
compose.

## Section 3 — Per-panel wiring

Each panel gets one `useAsyncAction()` instance and renders `<ErrorText>`.

- **GroceryList:** `toggleItem` mutation gets `withOptimisticUpdate(toggleItemOptimistic)`;
  the toggle handler calls `run(() => toggle({ id, checked }))`; render `<ErrorText>`.
- **Basket:** `remove` mutation gets `withOptimisticUpdate(removeFromBasketOptimistic)`;
  the `generate` action is called via `run` and its `pending` replaces the local
  `busy`/`setBusy` state (remove that `useState`); Remove button calls
  `run(() => remove({ recipeId }))`; render `<ErrorText>`.
- **RecipeForm:** `create` via `run`; reset title/ingredients only when
  `run(...) !== undefined`; `pending` replaces the local `busy`; render `<ErrorText>`.
- **RecipeList:** `delete`, edit-save, and `add` all go through one panel-level
  `run`, replacing the current `console.error`; render `<ErrorText>` once for the
  panel. (Edit-save keeps closing the dialog only on success.)

No optimistic update for `basket.add`; it keeps its current round-trip behavior.

## Section 4 — Test infrastructure + tests

- Add dev-deps to `apps/web/package.json`: `jsdom`, `@testing-library/react`
  (and its required `@testing-library/dom` peer if not pulled transitively).
- Add `apps/web/vitest.config.ts` with `test: { environment: "jsdom" }` (and
  `globals: true` only if needed). The existing `recipeService.test.ts`
  fetch-stub test must continue to pass under jsdom.
- Tests:
  - `errorMessage` — pure unit: `Error` instance → its `.message`; non-Error
    (string/object) → `String(e)`.
  - `useAsyncAction` — `renderHook`: **success** (pending true during, returns
    the value, error stays null, pending false after) and **failure** (rejected
    fn → error set to the message, returns undefined, pending false).
  - optimistic updaters — unit tests with a fake `OptimisticLocalStore`
    (object with `getQuery`/`setQuery` spies): `toggleItemOptimistic` flips
    `checked` only on the matching `_id`; `removeFromBasketOptimistic` filters
    out the matching `recipeId`; both no-op when `getQuery` returns `undefined`.
  - One component test: `GroceryList` with `convex/react` mocked
    (`useQuery` returns two lines, `useMutation` returns a rejecting fn) →
    toggling a checkbox renders the `.error` text via `ErrorText`. Proves the
    hook↔panel wiring end-to-end.
- Build gate: `pnpm --filter @pantry/web build` (`tsc -b` + `vite build`) +
  `( cd apps/web && pnpm test )`.

## Out of scope

- `basket.add` optimistic insert (synthetic-id reconciliation).
- Toasts / global error context / retry affordances.
- Heavy convex-bound component render tests beyond the one wiring test
  (BL-0014 Playwright e2e covers full interaction).
- Any recipe-service or Convex backend change — this is web-only.

## Testing summary

`pnpm --filter @pantry/web build` clean; `pnpm test` green (existing fetch test +
the new pure/hook/optimistic/component tests). Manual smoke (controller-run):
toggle a grocery item → no flicker; stop recipe-service → Generate / create /
delete each show an inline error instead of failing silently.
