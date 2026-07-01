# Clear Grocery List Design Spec

> Add a "Clear list" action to the grocery-list panel that empties the list
> (all rows for the user), confirm-guarded, with optimistic feedback.

## Goal

Let a user clear their whole grocery list in one action — a public Convex
`clearGroceryList` mutation plus a confirm-guarded "Clear list" button in the
`GroceryList` panel that empties instantly (optimistic) and surfaces errors
inline.

## Context

The grocery list is a per-user Convex table (`groceryList`: userId, item, unit,
quantity, checked). `groceryList.ts` already has `getGroceryList` (query),
`toggleItem` (mutation), and an internal `replaceGroceryList` that does a
delete-all-then-insert. The `GroceryList` panel (post-Tailwind-refresh) renders
lines as checkboxes via `Card` + `useAsyncAction` + `ErrorText`, and toggling is
optimistic (`toggleItemOptimistic` in `apps/web/src/lib/optimistic.ts`). The
optimistic pattern + a fake-`localStore` unit-test pattern are already
established (BL-0012). This builds on `main` (UI refresh merged; `Button`
primitive available).

## Decisions (from brainstorming)

- **Clear all** (empty the whole list), not clear-checked-only.
- **Confirm-guarded** via `window.confirm`, consistent with delete-recipe.
- **Optimistic** — empty the list instantly, consistent with toggle/remove.
- Based on `main` (not a separate pre-refresh branch), so it uses the `Button`
  primitive and the restyled panel.

## Section 1 — Convex `clearGroceryList` mutation

New **public** mutation in `packages/convex/convex/groceryList.ts`:
```ts
export const clearGroceryList = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("groceryList")
      .withIndex("by_user", (q) => q.eq("userId", DEV_USER_ID))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
```
- Idempotent — no-op when the list is already empty.
- Reuses the exact delete-loop already in `replaceGroceryList`; same
  `by_user` index + `DEV_USER_ID` (stubbed identity until BL-0004).
- Callable as `api.groceryList.clearGroceryList` — the generated `@pantry/convex`
  api picks new mutations up automatically (no codegen step).

## Section 2 — Optimistic updater

New `clearGroceryListOptimistic(localStore: OptimisticLocalStore)` in
`apps/web/src/lib/optimistic.ts`, mirroring the existing updaters:
```ts
export function clearGroceryListOptimistic(localStore: OptimisticLocalStore): void {
  const cur = localStore.getQuery(api.groceryList.getGroceryList, {});
  if (cur === undefined) return;
  localStore.setQuery(api.groceryList.getGroceryList, {}, []);
}
```
Sets the `getGroceryList` query cache to `[]` so the list empties instantly;
Convex rolls back if the server mutation rejects. No-op when the query is not yet
cached.

## Section 3 — GroceryList UI

In `apps/web/src/components/GroceryList.tsx`:
- Add `clearList = useMutation(api.groceryList.clearGroceryList).withOptimisticUpdate(clearGroceryListOptimistic)`.
- Add a **"Clear list"** `Button` (`variant="ghost"`, `size="sm"`), right-aligned
  below the list, **rendered only when `lines.length > 0`**.
- On click: `if (!window.confirm("Clear the grocery list?")) return;` then
  `run(() => clearList({}))` — reusing the panel's existing `useAsyncAction`
  (`run`/`error`), so a failure surfaces via the existing `<ErrorText>`.
- The checkbox/toggle wiring, `Card`, empty-state message, and `ErrorText` are
  otherwise unchanged.

## Section 4 — Testing

- **Optimistic updater** (`apps/web/src/lib/optimistic.test.ts`): with the
  existing fake-`localStore` helper, `clearGroceryListOptimistic` sets the cache
  to `[]` when populated, and no-ops (no `setQuery`) when `getQuery` returns
  `undefined`.
- **GroceryList component** (`apps/web/src/components/GroceryList.test.tsx`):
  extend the existing convex-mocked test —
  - with lines present and `window.confirm` stubbed to return `true`, clicking
    "Clear list" invokes the clear mutation;
  - the "Clear list" button is absent when the list is empty (`useQuery`
    returns `[]`).
  The existing checkbox + `role="alert"` cases stay green.
- **Convex mutation:** no automated test — consistent with the repo's existing
  untested Convex functions (`basket.remove`, `basket.updateTitle`); covered by
  the `tsc` typecheck, the web build gate, and manual smoke.
- **Build gate:** `pnpm --filter @pantry/web build` + `( cd apps/web && pnpm test )`.
- **Manual smoke (controller-run, web-only):** Generate a grocery list → click
  Clear list → confirm → it empties instantly and stays empty; with the backend
  down the error shows inline.

## Out of scope

- Clear-checked-only, undo, per-item delete (toggle already covers check-off).
- Any change to how the list is generated or to the basket.
- Real per-user auth (still `DEV_USER_ID`).
