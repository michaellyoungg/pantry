# Clear Grocery List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a confirm-guarded "Clear list" action that empties the grocery list, with optimistic feedback and inline error surfacing.

**Architecture:** A public Convex `clearGroceryList` mutation deletes all of the user's `groceryList` rows (reusing the existing delete-loop pattern). A `clearGroceryListOptimistic` updater empties the `getGroceryList` query cache instantly. The restyled `GroceryList` panel gets a "Clear list" `Button` (shown only when non-empty) that confirms then runs the mutation through the panel's existing `useAsyncAction`.

**Tech Stack:** Convex (`@pantry/convex` api, `convex/browser` `OptimisticLocalStore`), React 19, TypeScript, Tailwind primitives (`Button`, `Card`), vitest + jsdom + @testing-library/react.

## Global Constraints

- Web + Convex only; no recipe-service change. Stubbed identity stays `DEV_USER_ID`.
- `clearGroceryList` is a **public** `mutation` (args `{}`), idempotent, deleting all rows for `DEV_USER_ID` via the `by_user` index — same delete-loop as `replaceGroceryList`.
- `clearGroceryListOptimistic(localStore: OptimisticLocalStore): void` sets the `getGroceryList` query cache to `[]`; no-ops when the query is uncached. Mirrors the existing updaters in `apps/web/src/lib/optimistic.ts`.
- UI: a "Clear list" `Button` (`variant="ghost"`, `size="sm"`), right-aligned below the list, **rendered only when `lines.length > 0`**. Click → `window.confirm("Clear the grocery list?")`; if confirmed, `run(() => clearList({}))` via the panel's existing `useAsyncAction` (`run`/`error`) so failures surface through the existing `<ErrorText>`. `clearList` mutation wired with `.withOptimisticUpdate(clearGroceryListOptimistic)`.
- Preserve the existing checkbox/toggle wiring, `Card`, empty-state message, and `ErrorText`.
- The Convex mutation has no automated test (consistent with the repo's other untested Convex functions); the optimistic updater + component tests + web build + manual smoke cover the feature. Tests import vitest globals explicitly; assert semantics, not class strings.

---

## File Structure

```
packages/convex/convex/groceryList.ts   # MODIFY: add clearGroceryList mutation
apps/web/src/lib/optimistic.ts          # MODIFY: add clearGroceryListOptimistic
apps/web/src/lib/optimistic.test.ts     # MODIFY: clearGroceryListOptimistic tests
apps/web/src/components/GroceryList.tsx      # MODIFY: Clear list button + wiring
apps/web/src/components/GroceryList.test.tsx # MODIFY: configurable mock + clear tests
```

---

## Task 1: Clear mechanism (Convex mutation + optimistic updater)

**Files:**
- Modify: `packages/convex/convex/groceryList.ts`
- Modify: `apps/web/src/lib/optimistic.ts`, `apps/web/src/lib/optimistic.test.ts`

**Interfaces:**
- Consumes: `mutation` + `DEV_USER_ID` + the `by_user` index (existing in `groceryList.ts`); `OptimisticLocalStore` from `convex/browser`; `api` from `@pantry/convex/api`.
- Produces: `api.groceryList.clearGroceryList` (mutation, args `{}`); `clearGroceryListOptimistic(localStore: OptimisticLocalStore): void`.

- [ ] **Step 1: Add the clearGroceryList mutation**

Append to `packages/convex/convex/groceryList.ts` (after `toggleItem`; `mutation` and `DEV_USER_ID` are already imported):
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

- [ ] **Step 2: Write the failing optimistic-updater tests**

In `apps/web/src/lib/optimistic.test.ts`, update the import line to add `clearGroceryListOptimistic`:
```ts
import { toggleItemOptimistic, removeFromBasketOptimistic, clearGroceryListOptimistic } from "./optimistic";
```
And append a new describe block at the end of the file:
```ts
describe("clearGroceryListOptimistic", () => {
  it("empties the grocery list cache", () => {
    const { store, state } = fakeStore([
      { _id: "g1", item: "egg", unit: "", quantity: 1, checked: false },
      { _id: "g2", item: "milk", unit: "", quantity: 1, checked: true },
    ]);
    clearGroceryListOptimistic(store as never);
    expect(state.value).toEqual([]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    clearGroceryListOptimistic(store as never);
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/web && pnpm test src/lib/optimistic.test.ts`
Expected: FAIL — `clearGroceryListOptimistic` is not exported from `./optimistic`.

- [ ] **Step 4: Implement the optimistic updater**

Append to `apps/web/src/lib/optimistic.ts` (after `removeFromBasketOptimistic`; `OptimisticLocalStore` and `api` are already imported):
```ts
export function clearGroceryListOptimistic(localStore: OptimisticLocalStore): void {
  const cur = localStore.getQuery(api.groceryList.getGroceryList, {});
  if (cur === undefined) return;
  localStore.setQuery(api.groceryList.getGroceryList, {}, []);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd apps/web && pnpm test src/lib/optimistic.test.ts`
Expected: PASS — 6 cases (2 toggle + 2 remove + 2 clear).

- [ ] **Step 6: Typecheck the Convex functions + web build**

Run:
```bash
cd /home/myoung/projects/pantry/packages/convex && npx tsc --noEmit convex/*.ts --skipLibCheck
cd /home/myoung/projects/pantry && pnpm --filter @pantry/web build
```
Expected: the convex `tsc` pass is clean (the new mutation typechecks against the same imports as `toggleItem`); `tsc -b` + `vite build` clean. (If the convex `tsc` invocation errors for an environment reason unrelated to the new mutation — e.g. module-resolution on the generated files — report the exact output; the web build below is the authoritative gate that `api.groceryList.clearGroceryList` resolves, once Task 2 references it.)

- [ ] **Step 7: Commit**

```bash
cd /home/myoung/projects/pantry
git add packages/convex/convex/groceryList.ts apps/web/src/lib/optimistic.ts apps/web/src/lib/optimistic.test.ts
git commit -m "feat(convex): clearGroceryList mutation + optimistic updater"
```

---

## Task 2: GroceryList "Clear list" button + tests

**Files:**
- Modify: `apps/web/src/components/GroceryList.tsx`, `apps/web/src/components/GroceryList.test.tsx`

**Interfaces:**
- Consumes: `api.groceryList.clearGroceryList` + `clearGroceryListOptimistic` (Task 1); existing `Button`, `Card`, `ErrorText`, `useAsyncAction`, `toggleItemOptimistic`.
- Produces: the "Clear list" affordance (no new exported API).

- [ ] **Step 1: Refactor the test mock to be per-test configurable + add clear tests**

Replace the entire contents of `apps/web/src/components/GroceryList.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Hoisted, mutable so each test can set the query result; one shared mutation spy.
const { state, mutationMock } = vi.hoisted(() => ({
  state: { lines: [] as Array<Record<string, unknown>> },
  mutationMock: vi.fn(() => Promise.reject(new Error("toggle failed"))),
}));

vi.mock("convex/react", () => ({
  useQuery: () => state.lines,
  useMutation: () => {
    const fn = ((...args: unknown[]) => mutationMock(...args)) as unknown as {
      (...a: unknown[]): Promise<unknown>;
      withOptimisticUpdate: (u: unknown) => typeof fn;
    };
    fn.withOptimisticUpdate = () => fn;
    return fn;
  },
}));

import { GroceryList } from "./GroceryList";

const oneLine = [
  { _id: "g1", userId: "dev-user", item: "egg", unit: "", quantity: 1, checked: false, _creationTime: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.lines = oneLine;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GroceryList", () => {
  it("surfaces an inline error when toggling fails", async () => {
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("checkbox"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("toggle failed");
  });

  it("clears the list via the clear mutation when confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /clear list/i }));
    expect(mutationMock).toHaveBeenCalledTimes(1);
    // the shared mock rejects → let the run() settle so no act warning
    await screen.findByRole("alert");
  });

  it("does not clear when confirmation is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("button", { name: /clear list/i }));
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it("hides the Clear list button when the list is empty", () => {
    state.lines = [];
    render(<GroceryList />);
    expect(screen.queryByRole("button", { name: /clear list/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify the clear tests fail**

Run: `cd apps/web && pnpm test src/components/GroceryList.test.tsx`
Expected: FAIL — the "Clear list" button doesn't exist yet, so the `getByRole("button", { name: /clear list/i })` queries fail (the toggle-error and empty-list cases may pass, but the two clear cases fail).

- [ ] **Step 3: Add the Clear list button + wiring to GroceryList**

Replace the entire contents of `apps/web/src/components/GroceryList.tsx`:
```tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { useAsyncAction } from "../lib/useAsyncAction";
import { toggleItemOptimistic, clearGroceryListOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

export function GroceryList() {
  const lines = useQuery(api.groceryList.getGroceryList) ?? [];
  const toggle = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(toggleItemOptimistic);
  const clearList = useMutation(api.groceryList.clearGroceryList).withOptimisticUpdate(clearGroceryListOptimistic);
  const { run, error } = useAsyncAction();

  function onClear() {
    if (!window.confirm("Clear the grocery list?")) return;
    run(() => clearList({}));
  }

  return (
    <Card title="Grocery list">
      {lines.length === 0 && <p className="text-sm text-muted">Nothing yet — generate from your basket.</p>}
      <ul className="flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line._id}>
            <label
              className={`flex items-center gap-2 text-sm ${line.checked ? "text-muted line-through" : "text-text"}`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-primary)]"
                checked={line.checked}
                onChange={(e) => run(() => toggle({ id: line._id, checked: e.target.checked }))}
              />
              <span>
                {line.quantity} {line.unit} {line.item}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {lines.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear list
          </Button>
        </div>
      )}
      <ErrorText message={error} />
    </Card>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && pnpm test src/components/GroceryList.test.tsx`
Expected: PASS — 4 cases (toggle-error, clear-when-confirmed, no-clear-when-cancelled, hidden-when-empty).

- [ ] **Step 5: Build + full test gate**

Run:
```bash
cd /home/myoung/projects/pantry
pnpm --filter @pantry/web build
( cd apps/web && pnpm test )
```
Expected: `tsc -b` + `vite build` clean (confirms `api.groceryList.clearGroceryList` resolves through the generated api and the `.withOptimisticUpdate` typing); full vitest suite green (the prior 23 + 2 new optimistic clear cases + the restructured GroceryList file's 4 cases — report the actual total).

- [ ] **Step 6: Commit**

```bash
cd /home/myoung/projects/pantry
git add apps/web/src/components/GroceryList.tsx apps/web/src/components/GroceryList.test.tsx
git commit -m "feat(web): Clear list button on the grocery panel"
```

---

## Manual smoke (controller-run, after Task 2)

Not a task — web + Convex only, no container rebuild. **Push the new function to the running Convex deployment first** so the button works live: `pnpm --filter @pantry/convex exec convex dev --once` (deploys `clearGroceryList`). Then in the app: Generate a grocery list → a "Clear list" button appears → click it → confirm → the list empties instantly (optimistic) and stays empty; Cancel on the confirm leaves it untouched; the button is absent when the list is empty. With the backend stopped, clicking Clear surfaces an inline error and the list re-fills (optimistic rollback).

---

## Self-Review

**Spec coverage:**
- Public `clearGroceryList` mutation (idempotent, delete-loop, `by_user`/`DEV_USER_ID`) → Task 1 Step 1. ✓
- `clearGroceryListOptimistic` (empties cache, no-op when uncached) + tests → Task 1. ✓
- Clear list `Button` (ghost/sm, only when non-empty), confirm-guarded, via existing `useAsyncAction`/`ErrorText`, optimistic-wired → Task 2. ✓
- Existing checkbox/toggle/Card/empty-state/ErrorText preserved → Task 2 Step 3 (verbatim except the added button). ✓
- Optimistic updater test + component tests; Convex mutation untested-by-design → Tasks 1-2. ✓

**Placeholder scan:** complete code + exact commands in every step. No TBDs. (Task 1 Step 5 says "6 cases"; Task 2 Step 5 says "report the actual total" since the exact suite count depends on unrelated files.)

**Type consistency:** `clearGroceryListOptimistic(localStore: OptimisticLocalStore): void` identical across `optimistic.ts`, its tests, and the `.withOptimisticUpdate(clearGroceryListOptimistic)` call site. `clearList({})` matches the mutation's `args: {}`. The `GroceryList` toggle wiring, `ErrorText`, `Card`, and checkbox markup are unchanged from the current file.

**Note on the test-mock refactor (Task 2 Step 1):** the existing `GroceryList.test.tsx` returns one fixed `useQuery` array and one rejecting mutation. The refactor makes `useQuery` return mutable `state.lines` (so the empty-list case is testable) and routes all `useMutation` calls through one shared `mutationMock` (still rejecting "toggle failed", so the existing toggle-error assertion is preserved verbatim). This is a necessary test-infra change to cover the new button, not a loosening of the existing assertion.
