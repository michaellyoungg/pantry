# Web UI Interaction Polish (BL-0012) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the two fetch-on-mount panels (Catalog, RecipeList) distinct loading/empty/error states via a shared `useAsyncData` hook, and add optimistic updates for `needItAnyway` and `basket.add`.

**Architecture:** Mirror the codebase's existing write-side pattern (`useAsyncAction` + `ErrorText`) on the read side with a new `useAsyncData` hook, then add two helpers to the existing `optimistic.ts` and wire them into the components that already use sibling optimistic helpers.

**Tech Stack:** React 18 + TypeScript, Convex react hooks (`useAction`/`useMutation`/`withOptimisticUpdate`), Vitest + @testing-library/react, Biome (lint/format).

## Global Constraints

- Web package name: `@pantry/web`. Run web tests with `pnpm --filter @pantry/web exec vitest run <path>`; typecheck with `pnpm --filter @pantry/web typecheck`.
- **Biome ignores `**/.claude`.** This repo is a worktree under `.claude/`, so `pnpm lint` no-ops here. Lint/format changed files by **explicit path**: `pnpm exec biome check <files> --write`. Always do this before committing; a green `pnpm lint` from the worktree is meaningless.
- Do NOT use jest-dom matchers (`toBeInTheDocument`, etc.) — they are not set up. Assert presence with `screen.getByText(...)` (throws if absent) / `expect(...).toBeTruthy()` and absence with `expect(screen.queryByText(...)).toBeNull()`, matching existing tests.
- Error copy reaches users only through the existing `ErrorText` component (`<p role="alert" className="text-danger">`). No toast/banner system.
- Convex optimistic helpers live in `apps/web/src/lib/optimistic.ts` and take `(localStore: OptimisticLocalStore, args)`. Every helper guards `cur === undefined` and no-ops.

---

### Task 1: `useAsyncData` hook

**Files:**
- Create: `apps/web/src/lib/useAsyncData.ts`
- Test: `apps/web/src/lib/useAsyncData.test.ts`

**Interfaces:**
- Consumes: `errorMessage` from `apps/web/src/lib/useAsyncAction.ts`.
- Produces: `useAsyncData<T>(fn: () => Promise<T>, deps?: unknown[]): { data: T | undefined; loading: boolean; error: string | null; reload: () => void }`. Runs `fn` on mount, whenever any `deps` entry or `fn` identity changes, and whenever `reload()` is called. `data` is `undefined` until the first resolve; `loading` starts `true`; a settle after unmount is ignored.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/useAsyncData.test.ts`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsyncData } from "./useAsyncData";

describe("useAsyncData", () => {
  it("starts loading, then exposes resolved data", async () => {
    const fn = vi.fn(() => Promise.resolve([1, 2]));
    const { result } = renderHook(() => useAsyncData(fn));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([1, 2]);
    expect(result.current.error).toBeNull();
  });

  it("captures a rejection as an error and leaves data undefined", async () => {
    const fn = vi.fn(() => Promise.reject(new Error("down")));
    const { result } = renderHook(() => useAsyncData(fn));
    await waitFor(() => expect(result.current.error).toBe("down"));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("reload re-runs fn (error then success)", async () => {
    const fn = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce("ok");
    const { result } = renderHook(() => useAsyncData(fn));
    await waitFor(() => expect(result.current.error).toBe("down"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe("ok"));
    expect(result.current.error).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("re-runs when a dep changes", async () => {
    const fn = vi.fn(() => Promise.resolve("x"));
    const { rerender } = renderHook(({ k }) => useAsyncData(fn, [k]), {
      initialProps: { k: 0 },
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    rerender({ k: 1 });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pantry/web exec vitest run src/lib/useAsyncData.test.ts`
Expected: FAIL — cannot resolve `./useAsyncData`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/useAsyncData.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./useAsyncAction";

/**
 * Read-side analog of useAsyncAction: runs an imperative async load (a Convex
 * action / fetch) and tracks loading / data / error so callers can render the
 * three states distinctly instead of collapsing them. `reload()` re-runs `fn`
 * (e.g. from a Retry button or after a mutation). Re-runs when `fn` identity or
 * any `deps` entry changes; a result that settles after unmount is ignored.
 */
export function useAsyncData<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | undefined; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: caller-supplied deps are intentionally spread
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fn()
      .then((r) => {
        if (!active) return;
        setData(r);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(errorMessage(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fn, nonce, ...deps]);

  return { data, loading, error, reload };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pantry/web exec vitest run src/lib/useAsyncData.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint/format and commit**

```bash
pnpm exec biome check apps/web/src/lib/useAsyncData.ts apps/web/src/lib/useAsyncData.test.ts --write
git add apps/web/src/lib/useAsyncData.ts apps/web/src/lib/useAsyncData.test.ts
git commit -m "feat(web): add useAsyncData hook (read-side loading/error/reload)"
```

---

### Task 2: Catalog — distinct loading / empty / error states

**Files:**
- Modify: `apps/web/src/components/Catalog.tsx`
- Test: `apps/web/src/components/Catalog.test.tsx`

**Interfaces:**
- Consumes: `useAsyncData` (Task 1). `basket.add` stays a plain `useMutation` here — optimism is wired in Task 5.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the `describe("Catalog", ...)` block in `apps/web/src/components/Catalog.test.tsx` (keep the existing two tests):

```ts
  it("shows a loading state before the fetch resolves (not the empty state)", () => {
    listCatalog.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Catalog />);
    expect(screen.getByText(/loading catalog/i)).toBeTruthy();
    expect(screen.queryByText(/no catalog recipes/i)).toBeNull();
  });

  it("shows an error with retry (not the empty state) when the fetch fails", async () => {
    listCatalog.mockRejectedValueOnce(new Error("backend down")).mockResolvedValue([CAT]);
    render(<Catalog />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/backend down/i);
    expect(screen.queryByText(/no catalog recipes/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("Garlic Bread");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pantry/web exec vitest run src/components/Catalog.test.tsx`
Expected: FAIL — no "Loading catalog" text, no "retry" button, and the failing fetch currently shows the empty-state copy.

- [ ] **Step 3: Rewrite Catalog to use `useAsyncData`**

Replace the entire contents of `apps/web/src/components/Catalog.tsx` with:

```tsx
import { api } from "@pantry/convex/api";
import { useAction, useMutation } from "convex/react";
import { useAsyncAction } from "../lib/useAsyncAction";
import { useAsyncData } from "../lib/useAsyncData";
import { ErrorText } from "./ErrorText";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function Catalog() {
  const listCatalog = useAction(api.recipes.listCatalog);
  const addToBasket = useMutation(api.basket.add);
  const { data, loading, error: loadError, reload } = useAsyncData(listCatalog);
  const { run, error } = useAsyncAction();
  const recipes = data ?? [];

  return (
    <Card title="Catalog">
      {loading && <p className="text-sm text-muted">Loading catalog…</p>}
      {loadError && (
        <div className="flex items-center gap-2">
          <ErrorText message={loadError} />
          <Button variant="secondary" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !loadError && recipes.length === 0 && (
        <p className="text-sm text-muted">No catalog recipes yet.</p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {recipes.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            <span className="font-medium text-text">{r.title}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}
            >
              Add to basket
            </Button>
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
    </Card>
  );
}
```

(This drops the now-unused `useEffect`/`useState`/`Recipe` imports.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pantry/web exec vitest run src/components/Catalog.test.tsx`
Expected: PASS (4 tests — the two originals plus the two new).

- [ ] **Step 5: Lint/format and commit**

```bash
pnpm exec biome check apps/web/src/components/Catalog.tsx apps/web/src/components/Catalog.test.tsx --write
git add apps/web/src/components/Catalog.tsx apps/web/src/components/Catalog.test.tsx
git commit -m "feat(web): Catalog distinguishes loading / empty / error+retry"
```

---

### Task 3: RecipeList — distinct loading / empty / error states

**Files:**
- Modify: `apps/web/src/components/RecipeList.tsx`
- Test: `apps/web/src/components/RecipeList.test.tsx`

**Interfaces:**
- Consumes: `useAsyncData` (Task 1). Keeps `basket.remove` optimistic (existing) and `basket.add` plain (Task 5 wraps it). `reload()` replaces the old imperative `refresh()` after delete/edit.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `apps/web/src/components/RecipeList.test.tsx` (keep the existing cross-store-consistency describe). Reuse the file's existing `RECIPE` fixture and hoisted mocks:

```ts
describe("RecipeList read-side states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows a loading state before recipes resolve (not the empty state)", () => {
    listRecipes.mockReturnValue(new Promise(() => {}));
    render(<RecipeList refreshKey={0} />);
    expect(screen.getByText(/loading recipes/i)).toBeTruthy();
    expect(screen.queryByText(/no recipes yet/i)).toBeNull();
  });

  it("shows an error with retry (not the empty state) when the load fails", async () => {
    listRecipes.mockRejectedValueOnce(new Error("recipes down")).mockResolvedValue([RECIPE]);
    render(<RecipeList refreshKey={0} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/recipes down/i);
    expect(screen.queryByText(/no recipes yet/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("Garlic Bread");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pantry/web exec vitest run src/components/RecipeList.test.tsx`
Expected: FAIL — no loading text, no retry button; the rejected load currently shows the empty state.

- [ ] **Step 3: Rewrite RecipeList to use `useAsyncData`**

Replace the entire contents of `apps/web/src/components/RecipeList.tsx` with:

```tsx
import { api } from "@pantry/convex/api";
import type { Ingredient, Recipe } from "@pantry/types";
import { useAction, useMutation } from "convex/react";
import { useState } from "react";
import { removeFromBasketOptimistic } from "../lib/optimistic";
import { useAsyncAction } from "../lib/useAsyncAction";
import { useAsyncData } from "../lib/useAsyncData";
import { ErrorText } from "./ErrorText";
import { RecipeEditDialog } from "./RecipeEditDialog";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export function RecipeList({ refreshKey }: { refreshKey: number }) {
  const [editing, setEditing] = useState<Recipe | null>(null);
  const listRecipes = useAction(api.recipes.list);
  const deleteRecipe = useAction(api.recipes.remove);
  const updateRecipe = useAction(api.recipes.update);
  const addToBasket = useMutation(api.basket.add);
  const removeFromBasket = useMutation(api.basket.remove).withOptimisticUpdate(
    removeFromBasketOptimistic,
  );
  const updateBasketTitle = useMutation(api.basket.updateTitle);
  const { data, loading, error: loadError, reload } = useAsyncData(listRecipes, [refreshKey]);
  const { run, error, clearError, showError } = useAsyncAction();
  const recipes = data ?? [];

  // The recipe-service op is the source of truth. The Convex basket cleanup that
  // follows is best-effort: once the recipe is deleted/updated we must never let
  // a basket failure roll the UI back into an inconsistent state — always reload
  // so the list reflects reality, and surface a targeted note instead.
  async function onDelete(r: Recipe) {
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    const deleted = await run(async () => {
      await deleteRecipe({ id: r.id });
      return true;
    });
    if (!deleted) return;
    try {
      await removeFromBasket({ recipeId: r.id }); // idempotent no-op if not in basket
    } catch {
      showError(
        `Deleted "${r.title}", but couldn't update the basket — it may show a stale item until reload.`,
      );
    }
    reload();
  }

  async function onSaveEdit(title: string, ingredients: Ingredient[]) {
    if (!editing) return;
    const id = editing.id;
    const saved = await run(async () => {
      await updateRecipe({ id, title, ingredients });
      return true;
    });
    if (!saved) return;
    setEditing(null);
    try {
      await updateBasketTitle({ recipeId: id, title }); // idempotent no-op if not in basket
    } catch {
      showError(
        `Saved "${title}", but couldn't update the basket title — it may show the old title until reload.`,
      );
    }
    reload();
  }

  return (
    <Card title="Recipes">
      {loading && <p className="text-sm text-muted">Loading recipes…</p>}
      {loadError && (
        <div className="flex items-center gap-2">
          <ErrorText message={loadError} />
          <Button variant="secondary" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !loadError && recipes.length === 0 && (
        <p className="text-sm text-muted">No recipes yet.</p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {recipes.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            <span className="font-medium text-text">{r.title}</span>
            <span className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}
              >
                Add to basket
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearError();
                  setEditing(r);
                }}
              >
                Edit
              </Button>
              <Button variant="danger" size="sm" onClick={() => onDelete(r)}>
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
      {editing && (
        <RecipeEditDialog recipe={editing} onSave={onSaveEdit} onClose={() => setEditing(null)} />
      )}
    </Card>
  );
}
```

(This drops the now-unused `useCallback`/`useEffect` imports and the old `refresh` callback; `reload()` replaces it. The old effect ran `listRecipes` on `[refreshKey, listRecipes]` — `useAsyncData(listRecipes, [refreshKey])` preserves that trigger.)

- [ ] **Step 4: Run the full RecipeList suite to verify pass (new + existing)**

Run: `pnpm --filter @pantry/web exec vitest run src/components/RecipeList.test.tsx`
Expected: PASS. The existing "still refreshes … when basket cleanup fails after delete" test still holds: mount calls `listRecipes` once, `reload()` after delete calls it again (≥2 calls), the second resolves `[]` so the row disappears, and the basket-failure `showError` alert renders.

- [ ] **Step 5: Lint/format and commit**

```bash
pnpm exec biome check apps/web/src/components/RecipeList.tsx apps/web/src/components/RecipeList.test.tsx --write
git add apps/web/src/components/RecipeList.tsx apps/web/src/components/RecipeList.test.tsx
git commit -m "feat(web): RecipeList distinguishes loading / empty / error+retry"
```

---

### Task 4: Optimistic update for `needItAnyway`

**Files:**
- Modify: `apps/web/src/lib/optimistic.ts`
- Modify: `apps/web/src/components/GroceryList.tsx:18`
- Test: `apps/web/src/lib/optimistic.test.ts`

**Interfaces:**
- Produces: `needItAnywayOptimistic(localStore, { id: Id<"groceryList"> }): void` — patches `alreadyHave: false` on the matching `getGroceryList` line.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/lib/optimistic.test.ts`. First extend the import at the top of the file to include the new helper (add only `needItAnywayOptimistic` here — Task 5 adds `addToBasketOptimistic`):

```ts
import {
  clearGroceryListOptimistic,
  needItAnywayOptimistic,
  removeFromBasketOptimistic,
  toggleItemOptimistic,
} from "./optimistic";
```

Then add:

```ts
describe("needItAnywayOptimistic", () => {
  it("clears alreadyHave only on the matching id", () => {
    const { store, state } = fakeStore([
      { _id: "g1", item: "butter", alreadyHave: true },
      { _id: "g2", item: "milk", alreadyHave: true },
    ]);
    needItAnywayOptimistic(store as never, { id: "g1" as never });
    expect(state.value).toEqual([
      { _id: "g1", item: "butter", alreadyHave: false },
      { _id: "g2", item: "milk", alreadyHave: true },
    ]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    needItAnywayOptimistic(store as never, { id: "g1" as never });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pantry/web exec vitest run src/lib/optimistic.test.ts`
Expected: FAIL — `needItAnywayOptimistic` is not exported.

- [ ] **Step 3: Add the helper**

Append to `apps/web/src/lib/optimistic.ts`:

```ts
export function needItAnywayOptimistic(
  localStore: OptimisticLocalStore,
  args: { id: Id<"groceryList"> },
): void {
  const cur = localStore.getQuery(api.groceryList.getGroceryList, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.groceryList.getGroceryList,
    {},
    cur.map((l) => (l._id === args.id ? { ...l, alreadyHave: false } : l)),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pantry/web exec vitest run src/lib/optimistic.test.ts`
Expected: PASS (existing tests plus the two new `needItAnywayOptimistic` tests).

- [ ] **Step 5: Wire it into GroceryList**

In `apps/web/src/components/GroceryList.tsx`, update the optimistic import (line 4) and the `needItAnyway` declaration (line 18):

```tsx
import {
  clearGroceryListOptimistic,
  needItAnywayOptimistic,
  toggleItemOptimistic,
} from "../lib/optimistic";
```

```tsx
  const needItAnyway = useMutation(api.groceryList.needItAnyway).withOptimisticUpdate(
    needItAnywayOptimistic,
  );
```

- [ ] **Step 6: Run the GroceryList suite to confirm no regression**

Run: `pnpm --filter @pantry/web exec vitest run src/components/GroceryList.test.tsx`
Expected: PASS. (The GroceryList test's `useMutation` mock already returns a fn carrying `withOptimisticUpdate`, so the new wrap needs no mock change.)

- [ ] **Step 7: Lint/format and commit**

```bash
pnpm exec biome check apps/web/src/lib/optimistic.ts apps/web/src/lib/optimistic.test.ts apps/web/src/components/GroceryList.tsx --write
git add apps/web/src/lib/optimistic.ts apps/web/src/lib/optimistic.test.ts apps/web/src/components/GroceryList.tsx
git commit -m "feat(web): optimistic update for needItAnyway"
```

---

### Task 5: Optimistic update for `basket.add`

**Files:**
- Modify: `apps/web/src/lib/optimistic.ts`
- Modify: `apps/web/src/components/Catalog.tsx`, `apps/web/src/components/RecipeList.tsx`
- Test: `apps/web/src/lib/optimistic.test.ts`, `apps/web/src/components/Catalog.test.tsx`

**Interfaces:**
- Produces: `addToBasketOptimistic(localStore, { recipeId: string; title: string }): void` — appends a synthetic `basket.list` row when the recipe isn't already present (idempotent, matching the server mutation); the synthetic row carries placeholder Convex system fields the server confirmation overwrites.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/lib/optimistic.test.ts`. Extend the import at the top of the file to add `addToBasketOptimistic`:

```ts
import {
  addToBasketOptimistic,
  clearGroceryListOptimistic,
  needItAnywayOptimistic,
  removeFromBasketOptimistic,
  toggleItemOptimistic,
} from "./optimistic";
```

Then add:

```ts
describe("addToBasketOptimistic", () => {
  it("appends a row when the recipe is not already in the basket", () => {
    const { store, state } = fakeStore([{ _id: "b1", recipeId: "r1", title: "Toast" }]);
    addToBasketOptimistic(store as never, { recipeId: "r2", title: "Salad" });
    expect((state.value as Array<{ recipeId: string }>).map((b) => b.recipeId)).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("is a no-op when the recipe is already in the basket", () => {
    const { store, state } = fakeStore([{ _id: "b1", recipeId: "r1", title: "Toast" }]);
    addToBasketOptimistic(store as never, { recipeId: "r1", title: "Toast" });
    expect((state.value as unknown[]).length).toBe(1);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    addToBasketOptimistic(store as never, { recipeId: "r1", title: "x" });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pantry/web exec vitest run src/lib/optimistic.test.ts`
Expected: FAIL — `addToBasketOptimistic` is not exported.

- [ ] **Step 3: Add the helper**

Append to `apps/web/src/lib/optimistic.ts`:

```ts
export function addToBasketOptimistic(
  localStore: OptimisticLocalStore,
  args: { recipeId: string; title: string },
): void {
  const cur = localStore.getQuery(api.basket.list, {});
  if (cur === undefined) return;
  if (cur.some((b) => b.recipeId === args.recipeId)) return; // server add is idempotent
  localStore.setQuery(api.basket.list, {}, [
    ...cur,
    {
      // Placeholder system/owner fields; overwritten when the server confirms.
      // No `weekday`, so it lands on the unscheduled rail like a real fresh add.
      _id: `optimistic-${args.recipeId}` as Id<"basket">,
      _creationTime: 0,
      userId: "",
      recipeId: args.recipeId,
      title: args.title,
    },
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pantry/web exec vitest run src/lib/optimistic.test.ts`
Expected: PASS (all optimistic tests, including the three new `addToBasketOptimistic` tests). If TypeScript rejects the synthetic row against `Doc<"basket">`, add the missing required fields shown by the compiler; do NOT loosen the helper's arg types. (Fallback per spec: if it can't be typed without unreasonable casting, skip wiring below, leave `basket.add` plain, and note it in the commit — the rest of the task still stands.)

- [ ] **Step 5: Wire into Catalog**

In `apps/web/src/components/Catalog.tsx`, import the helper and wrap the mutation:

```tsx
import { addToBasketOptimistic } from "../lib/optimistic";
```

```tsx
  const addToBasket = useMutation(api.basket.add).withOptimisticUpdate(addToBasketOptimistic);
```

- [ ] **Step 6: Update the Catalog test mock to carry `withOptimisticUpdate`**

In `apps/web/src/components/Catalog.test.tsx`, replace the hoisted block so the add mock exposes `withOptimisticUpdate` (returning itself), or the component render throws:

```ts
const { listCatalog, addMock } = vi.hoisted(() => {
  const addMock = vi.fn(() => Promise.resolve()) as unknown as {
    (...a: unknown[]): Promise<unknown>;
    withOptimisticUpdate: (u: unknown) => typeof addMock;
  };
  addMock.withOptimisticUpdate = () => addMock;
  return { listCatalog: vi.fn(), addMock };
});
```

(The `vi.mock("convex/react", ...)` block and the `expect(addMock).toHaveBeenCalledWith(...)` assertion are unchanged — calling `addMock` still records the call.)

- [ ] **Step 7: Wire into RecipeList**

In `apps/web/src/components/RecipeList.tsx`, add `addToBasketOptimistic` to the existing `../lib/optimistic` import and wrap the mutation:

```tsx
import { addToBasketOptimistic, removeFromBasketOptimistic } from "../lib/optimistic";
```

```tsx
  const addToBasket = useMutation(api.basket.add).withOptimisticUpdate(addToBasketOptimistic);
```

(RecipeList's test mock already returns a mutation with `withOptimisticUpdate`, so no test change is needed there.)

- [ ] **Step 8: Run the affected suites**

Run: `pnpm --filter @pantry/web exec vitest run src/lib/optimistic.test.ts src/components/Catalog.test.tsx src/components/RecipeList.test.tsx`
Expected: PASS across all three.

- [ ] **Step 9: Lint/format and commit**

```bash
pnpm exec biome check apps/web/src/lib/optimistic.ts apps/web/src/lib/optimistic.test.ts apps/web/src/components/Catalog.tsx apps/web/src/components/Catalog.test.tsx apps/web/src/components/RecipeList.tsx --write
git add apps/web/src/lib/optimistic.ts apps/web/src/lib/optimistic.test.ts apps/web/src/components/Catalog.tsx apps/web/src/components/Catalog.test.tsx apps/web/src/components/RecipeList.tsx
git commit -m "feat(web): optimistic update for basket.add (Catalog + RecipeList)"
```

---

### Task 6: Whole-package verification + backlog closeout

**Files:**
- Modify: `docs/backlog/BL-0012-web-ui-interaction-polish.md`, `docs/backlog/README.md`

**Interfaces:** none.

- [ ] **Step 1: Full web test suite**

Run: `pnpm --filter @pantry/web exec vitest run`
Expected: PASS (all suites, including the pre-existing ones).

- [ ] **Step 2: Typecheck the web package**

Run: `pnpm --filter @pantry/web typecheck`
Expected: no errors.

- [ ] **Step 3: Biome check (no `--write`) on every touched file**

Run:
```bash
pnpm exec biome check \
  apps/web/src/lib/useAsyncData.ts apps/web/src/lib/useAsyncData.test.ts \
  apps/web/src/lib/optimistic.ts apps/web/src/lib/optimistic.test.ts \
  apps/web/src/components/Catalog.tsx apps/web/src/components/Catalog.test.tsx \
  apps/web/src/components/RecipeList.tsx apps/web/src/components/RecipeList.test.tsx \
  apps/web/src/components/GroceryList.tsx
```
Expected: no diagnostics (exit 0, files checked > 0).

- [ ] **Step 4: Flip BL-0012 to done and link the spec**

In `docs/backlog/BL-0012-web-ui-interaction-polish.md` set `status: done` and add `related_specs: [2026-08-03-web-ui-interaction-polish-design.md]` (the item currently lists `2026-06-29-web-app.md`; keep both). In `docs/backlog/README.md` change the BL-0012 row's Status cell from `in-progress` to `done`.

- [ ] **Step 5: Commit**

```bash
git add docs/backlog/BL-0012-web-ui-interaction-polish.md docs/backlog/README.md
git commit -m "chore(backlog): mark BL-0012 done, link design spec"
```

- [ ] **Step 6: Hand off to finishing-a-development-branch** for the whole-branch review, PR, and merge steps.

---

## Self-Review

**Spec coverage:**
- Goal 1 (no load swallows its rejection) → Tasks 2, 3 (both replace `.catch(console.error)` with `useAsyncData`).
- Goal 2 (Catalog/RecipeList distinguish loading/empty/error) → Tasks 2, 3 with explicit tests asserting the down-backend case does NOT show empty copy.
- Goal 3 (needItAnyway + basket.add optimistic) → Tasks 4, 5.
- Goal 4 (shared read-side primitive) → Task 1.
- Non-goals (query conversion, other basket mutations) → untouched; noted.

**Placeholder scan:** No "TBD"/"handle errors appropriately"/"similar to Task N". Every code step shows complete code; the one fallback (Task 5 Step 4) is an explicit, spec-sanctioned branch with concrete instructions, not a vague deferral.

**Type consistency:** `useAsyncData(fn, deps?)` returns `{ data, loading, error, reload }` — consumed identically in Tasks 2 and 3 (`error: loadError` rename at call site is local). `addToBasketOptimistic`/`needItAnywayOptimistic` signatures match between their definitions (Tasks 4/5) and their wiring. `errorMessage` is imported from `useAsyncAction.ts` where it already lives.

**Ordering:** Task 1 (hook) precedes its consumers (2, 3). Each task imports only symbols that exist at its own boundary — Task 4 imports `needItAnywayOptimistic`, Task 5 extends the import to add `addToBasketOptimistic` — so every task compiles and tests green in isolation for a fresh per-task subagent.
