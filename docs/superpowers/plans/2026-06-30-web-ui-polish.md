# Web UI Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the grocery check-off flicker (Convex optimistic updates) and replace silent failures with inline per-panel error messages, across `RecipeForm`, `Basket`, `GroceryList`, and `RecipeList`.

**Architecture:** A reusable `useAsyncAction` hook centralizes pending/error state for any async call; a tiny `ErrorText` component renders the message. Two `withOptimisticUpdate` updater functions (`toggleItemOptimistic`, `removeFromBasketOptimistic`) live in `lib/optimistic.ts` and are wired into the relevant `useMutation` call sites. The four panels are rewired to route their async calls through the hook and render `<ErrorText>`. A new jsdom + Testing Library test setup makes the hook, updaters, and one representative panel testable.

**Tech Stack:** React 19, Vite, TypeScript, Convex (`@pantry/convex` api + `convex/browser` `OptimisticLocalStore`), vitest + jsdom + @testing-library/react.

## Global Constraints

- Web-only change — no recipe-service or Convex backend modification.
- Error surfacing goes through one shared `useAsyncAction` hook; no per-panel bespoke try/catch boilerplate. Each panel renders `<ErrorText>`.
- A wrapped call's success is signaled by the wrapped fn **returning a truthy value** (the created recipe, or `true`); callers gate post-success work with `if (await run(...)) { ... }`. On rejection `run` stores the message and returns `undefined`.
- Optimistic updates only for `groceryList.toggleItem` and `basket.remove`. `basket.add` stays non-optimistic.
- `removeFromBasketOptimistic` is wired into **both** `useMutation(api.basket.remove)` call sites (Basket + RecipeList) via the one shared updater.
- Error message derivation: `e instanceof Error ? e.message : String(e)` (the `errorMessage` helper).
- Tests import vitest globals explicitly (`import { describe, it, expect, vi } from "vitest"`); do NOT enable `globals`. Assert DOM text via `.textContent` (no jest-dom dep).
- Types: `groceryList.toggleItem` args are `{ id: Id<"groceryList">; checked: boolean }`; `basket.remove` args are `{ recipeId: string }`. `Id` comes from `@pantry/convex/dataModel`; `OptimisticLocalStore` from `convex/browser`.
- Stylesheet is `apps/web/src/App.css` (where `.panel` is defined).

---

## File Structure

```
apps/web/
  vite.config.ts                 # MODIFY: add vitest `test: { environment: "jsdom" }` + types ref
  package.json                   # MODIFY: add devDeps jsdom, @testing-library/react, @testing-library/dom
  src/
    lib/useAsyncAction.ts        # CREATE: useAsyncAction hook + errorMessage helper
    lib/useAsyncAction.test.ts   # CREATE: errorMessage + hook tests (renderHook)
    lib/optimistic.ts            # CREATE: toggleItemOptimistic + removeFromBasketOptimistic
    lib/optimistic.test.ts       # CREATE: updater unit tests (fake localStore)
    components/ErrorText.tsx      # CREATE: presentational error line
    components/GroceryList.tsx    # MODIFY: optimistic toggle + hook + ErrorText
    components/GroceryList.test.tsx # CREATE: convex-mocked wiring test
    components/Basket.tsx         # MODIFY: optimistic remove + hook (gen/rm) + ErrorText
    components/RecipeForm.tsx     # MODIFY: hook + ErrorText
    components/RecipeList.tsx     # MODIFY: hook + optimistic remove + ErrorText
    App.css                       # MODIFY: add .error rule
```

---

## Task 1: Error primitives + DOM test infrastructure

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/App.css`
- Create: `apps/web/src/lib/useAsyncAction.ts`, `apps/web/src/lib/useAsyncAction.test.ts`, `apps/web/src/components/ErrorText.tsx`

**Interfaces:**
- Consumes: React (`useState`, `useCallback`).
- Produces:
  - `errorMessage(e: unknown): string`
  - `useAsyncAction(): { run: <T>(fn: () => Promise<T>) => Promise<T | undefined>; error: string | null; pending: boolean; clearError: () => void }`
  - `ErrorText({ message }: { message: string | null })` — renders `<p className="error" role="alert">{message}</p>` or `null`.

- [ ] **Step 1: Add the DOM test dev-dependencies**

Run (from repo root):
```bash
pnpm --filter @pantry/web add -D jsdom @testing-library/react @testing-library/dom
```
Expected: `apps/web/package.json` gains the three devDeps; lockfile updates.

- [ ] **Step 2: Point vitest at jsdom**

Replace `apps/web/vite.config.ts` with:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 3: Verify the existing test still passes under jsdom**

Run: `cd apps/web && pnpm test`
Expected: the existing `src/lib/recipeService.test.ts` (5 cases) still PASSES under the jsdom environment.

- [ ] **Step 4: Write the failing error-primitives tests**

Create `apps/web/src/lib/useAsyncAction.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAsyncAction, errorMessage } from "./useAsyncAction";

describe("errorMessage", () => {
  it("returns the message for an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
  it("stringifies a non-Error", () => {
    expect(errorMessage("nope")).toBe("nope");
  });
});

describe("useAsyncAction", () => {
  it("returns the resolved value and leaves error null on success", async () => {
    const { result } = renderHook(() => useAsyncAction());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.run(() => Promise.resolve(42));
    });
    expect(returned).toBe(42);
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it("sets error and returns undefined on rejection", async () => {
    const { result } = renderHook(() => useAsyncAction());
    let returned: unknown = "sentinel";
    await act(async () => {
      returned = await result.current.run(() => Promise.reject(new Error("down")));
    });
    expect(returned).toBeUndefined();
    expect(result.current.error).toBe("down");
    expect(result.current.pending).toBe(false);
  });

  it("clearError resets the error", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("x")));
    });
    expect(result.current.error).toBe("x");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `cd apps/web && pnpm test src/lib/useAsyncAction.test.ts`
Expected: FAIL — `useAsyncAction`/`errorMessage` not exported (module not found / undefined).

- [ ] **Step 6: Implement the hook + helper**

Create `apps/web/src/lib/useAsyncAction.ts`:
```ts
import { useCallback, useState } from "react";

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useAsyncAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { run, error, pending, clearError };
}
```

- [ ] **Step 7: Run to verify pass**

Run: `cd apps/web && pnpm test src/lib/useAsyncAction.test.ts`
Expected: PASS (5 cases: 2 errorMessage + 3 hook).

- [ ] **Step 8: Create ErrorText + the .error style**

Create `apps/web/src/components/ErrorText.tsx`:
```tsx
export function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}
```
Append to `apps/web/src/App.css`:
```css
.error { color: #c00; font-size: .85rem; margin: .25rem 0 0; }
```

- [ ] **Step 9: Full suite + build gate**

Run:
```bash
cd /home/myoung/projects/pantry
pnpm --filter @pantry/web build
( cd apps/web && pnpm test )
```
Expected: `tsc -b` + `vite build` clean (ErrorText typechecks even though not yet used — it's exported); vitest green (existing 5 + new 5).

- [ ] **Step 10: Commit**

```bash
cd /home/myoung/projects/pantry
git add apps/web/package.json pnpm-lock.yaml apps/web/vite.config.ts apps/web/src/lib/useAsyncAction.ts apps/web/src/lib/useAsyncAction.test.ts apps/web/src/components/ErrorText.tsx apps/web/src/App.css
git commit -m "feat(web): useAsyncAction hook + ErrorText + jsdom test setup"
```

---

## Task 2: Optimistic update functions

**Files:**
- Create: `apps/web/src/lib/optimistic.ts`, `apps/web/src/lib/optimistic.test.ts`

**Interfaces:**
- Consumes: `OptimisticLocalStore` from `convex/browser`; `Id` from `@pantry/convex/dataModel`; `api` from `@pantry/convex/api`.
- Produces:
  - `toggleItemOptimistic(localStore: OptimisticLocalStore, args: { id: Id<"groceryList">; checked: boolean }): void`
  - `removeFromBasketOptimistic(localStore: OptimisticLocalStore, args: { recipeId: string }): void`

- [ ] **Step 1: Write the failing updater tests**

Create `apps/web/src/lib/optimistic.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { toggleItemOptimistic, removeFromBasketOptimistic } from "./optimistic";

// Minimal fake store: a single cached value, ignoring which query is asked for.
function fakeStore(initial: unknown) {
  const state = { value: initial };
  const store = {
    getQuery: vi.fn(() => state.value),
    setQuery: vi.fn((_query: unknown, _args: unknown, next: unknown) => {
      state.value = next;
    }),
  };
  return { store, state };
}

describe("toggleItemOptimistic", () => {
  it("flips checked only on the matching id", () => {
    const { store, state } = fakeStore([
      { _id: "g1", item: "egg", unit: "", quantity: 1, checked: false },
      { _id: "g2", item: "milk", unit: "", quantity: 1, checked: false },
    ]);
    toggleItemOptimistic(store as never, { id: "g1" as never, checked: true });
    expect(state.value).toEqual([
      { _id: "g1", item: "egg", unit: "", quantity: 1, checked: true },
      { _id: "g2", item: "milk", unit: "", quantity: 1, checked: false },
    ]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    toggleItemOptimistic(store as never, { id: "g1" as never, checked: true });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});

describe("removeFromBasketOptimistic", () => {
  it("filters out the matching recipeId", () => {
    const { store, state } = fakeStore([
      { _id: "b1", recipeId: "r1", title: "Toast" },
      { _id: "b2", recipeId: "r2", title: "Salad" },
    ]);
    removeFromBasketOptimistic(store as never, { recipeId: "r1" });
    expect(state.value).toEqual([{ _id: "b2", recipeId: "r2", title: "Salad" }]);
  });

  it("no-ops when the query is not in the cache", () => {
    const { store } = fakeStore(undefined);
    removeFromBasketOptimistic(store as never, { recipeId: "r1" });
    expect(store.setQuery).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm test src/lib/optimistic.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the optimistic updaters**

Create `apps/web/src/lib/optimistic.ts`:
```ts
import type { OptimisticLocalStore } from "convex/browser";
import type { Id } from "@pantry/convex/dataModel";
import { api } from "@pantry/convex/api";

export function toggleItemOptimistic(
  localStore: OptimisticLocalStore,
  args: { id: Id<"groceryList">; checked: boolean },
): void {
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
): void {
  const cur = localStore.getQuery(api.basket.list, {});
  if (cur === undefined) return;
  localStore.setQuery(
    api.basket.list,
    {},
    cur.filter((b) => b.recipeId !== args.recipeId),
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && pnpm test src/lib/optimistic.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Typecheck (the generated-type wiring is the real risk here)**

Run: `cd apps/web && pnpm typecheck`
Expected: `tsc -b --noEmit` clean — confirms `getQuery`/`setQuery` against `api.groceryList.getGroceryList` / `api.basket.list` line up with `Id<"groceryList">` and the doc shapes.

- [ ] **Step 6: Commit**

```bash
cd /home/myoung/projects/pantry
git add apps/web/src/lib/optimistic.ts apps/web/src/lib/optimistic.test.ts
git commit -m "feat(web): optimistic updaters for toggleItem + basket remove"
```

---

## Task 3: Wire the panels (hook + ErrorText + optimistic)

**Files:**
- Modify: `apps/web/src/components/GroceryList.tsx`, `Basket.tsx`, `RecipeForm.tsx`, `RecipeList.tsx`
- Create: `apps/web/src/components/GroceryList.test.tsx`

**Interfaces:**
- Consumes: `useAsyncAction` (Task 1), `ErrorText` (Task 1), `toggleItemOptimistic` / `removeFromBasketOptimistic` (Task 2); existing `recipeService` functions and Convex `api`.
- Produces: rewired panels (no new exported API).

- [ ] **Step 1: Rewire GroceryList (optimistic toggle + error)**

Replace the entire contents of `apps/web/src/components/GroceryList.tsx`:
```tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { useAsyncAction } from "../lib/useAsyncAction";
import { toggleItemOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";

export function GroceryList() {
  const lines = useQuery(api.groceryList.getGroceryList) ?? [];
  const toggle = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(toggleItemOptimistic);
  const { run, error } = useAsyncAction();

  return (
    <div className="panel">
      <h2>Grocery list</h2>
      {lines.length === 0 && <p>Nothing yet — generate from your basket.</p>}
      <ul>
        {lines.map((line) => (
          <li key={line._id}>
            <label style={{ textDecoration: line.checked ? "line-through" : "none" }}>
              <input
                type="checkbox"
                checked={line.checked}
                onChange={(e) => run(() => toggle({ id: line._id, checked: e.target.checked }))}
              />
              {line.quantity} {line.unit} {line.item}
            </label>
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
    </div>
  );
}
```

- [ ] **Step 2: Write the failing GroceryList wiring test**

Create `apps/web/src/components/GroceryList.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Hoisted so the vi.mock factory can reference it.
const { rejectingToggle } = vi.hoisted(() => {
  const fn = vi.fn(() => Promise.reject(new Error("toggle failed"))) as unknown as {
    (...a: unknown[]): Promise<unknown>;
    withOptimisticUpdate: ReturnType<typeof vi.fn>;
  };
  fn.withOptimisticUpdate = vi.fn(() => fn);
  return { rejectingToggle: fn };
});

vi.mock("convex/react", () => ({
  useQuery: () => [
    { _id: "g1", userId: "dev-user", item: "egg", unit: "", quantity: 1, checked: false, _creationTime: 0 },
  ],
  useMutation: () => rejectingToggle,
}));

import { GroceryList } from "./GroceryList";

describe("GroceryList", () => {
  beforeEach(() => rejectingToggle.mockClear());

  it("surfaces an inline error when toggling fails", async () => {
    render(<GroceryList />);
    fireEvent.click(screen.getByRole("checkbox"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("toggle failed");
  });
});
```

- [ ] **Step 3: Run to verify it passes (GroceryList already wired in Step 1)**

Run: `cd apps/web && pnpm test src/components/GroceryList.test.tsx`
Expected: PASS — the click rejects, `useAsyncAction` catches, `ErrorText` renders `role="alert"` with the message. (If this fails because the mocked `withOptimisticUpdate` isn't returning the callable, confirm the hoisted `fn.withOptimisticUpdate = vi.fn(() => fn)` returns `fn`.)

- [ ] **Step 4: Rewire Basket (optimistic remove + separate gen/rm hooks)**

Replace the entire contents of `apps/web/src/components/Basket.tsx`:
```tsx
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@pantry/convex/api";
import { useAsyncAction } from "../lib/useAsyncAction";
import { removeFromBasketOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";

export function Basket() {
  const items = useQuery(api.basket.list) ?? [];
  const remove = useMutation(api.basket.remove).withOptimisticUpdate(removeFromBasketOptimistic);
  const generate = useAction(api.recipes.generateGroceryList);
  const gen = useAsyncAction();
  const rm = useAsyncAction();

  return (
    <div className="panel">
      <h2>Basket</h2>
      {items.length === 0 && <p>Basket is empty.</p>}
      <ul>
        {items.map((b) => (
          <li key={b._id}>
            <span>{b.title}</span>
            <button onClick={() => rm.run(() => remove({ recipeId: b.recipeId }))}>Remove</button>
          </li>
        ))}
      </ul>
      <button onClick={() => gen.run(() => generate({}))} disabled={gen.pending || items.length === 0}>
        {gen.pending ? "Generating…" : "Generate grocery list"}
      </button>
      <ErrorText message={gen.error ?? rm.error} />
    </div>
  );
}
```
(Two hook instances: `gen` drives the Generate button's pending label and its errors; `rm` carries remove errors. One combined `<ErrorText>` shows whichever is set. This avoids a Remove click relabeling the Generate button.)

- [ ] **Step 5: Rewire RecipeForm (hook + error, reset only on success)**

Replace the entire contents of `apps/web/src/components/RecipeForm.tsx`:
```tsx
import { useState } from "react";
import type { Ingredient } from "@pantry/types";
import { createRecipe } from "../lib/recipeService";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";

const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

export function RecipeForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([emptyIngredient()]);
  const { run, error, pending } = useAsyncAction();

  function update(i: number, patch: Partial<Ingredient>) {
    setIngredients((prev) => prev.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const created = await run(() =>
      createRecipe({
        title: title.trim(),
        ingredients: ingredients.filter((ing) => ing.item.trim() !== ""),
      }),
    );
    if (created) {
      setTitle("");
      setIngredients([emptyIngredient()]);
      onCreated();
    }
  }

  return (
    <form onSubmit={submit} className="panel">
      <h2>New recipe</h2>
      <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      {ingredients.map((ing, i) => (
        <div key={i} className="ingredient-row">
          <input
            type="number"
            value={ing.quantity}
            onChange={(e) => update(i, { quantity: Number(e.target.value) })}
            style={{ width: "4rem" }}
          />
          <input placeholder="unit" value={ing.unit} onChange={(e) => update(i, { unit: e.target.value })} />
          <input placeholder="item" value={ing.item} onChange={(e) => update(i, { item: e.target.value })} />
        </div>
      ))}
      <button type="button" onClick={() => setIngredients((p) => [...p, emptyIngredient()])}>
        + ingredient
      </button>
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Create recipe"}
      </button>
      <ErrorText message={error} />
    </form>
  );
}
```

- [ ] **Step 6: Rewire RecipeList (hook + optimistic remove + error)**

Replace the entire contents of `apps/web/src/components/RecipeList.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";
import type { Recipe, Ingredient } from "@pantry/types";
import { useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { deleteRecipe, listRecipes, updateRecipe } from "../lib/recipeService";
import { useAsyncAction } from "../lib/useAsyncAction";
import { removeFromBasketOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";
import { RecipeEditDialog } from "./RecipeEditDialog";

export function RecipeList({ refreshKey }: { refreshKey: number }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const addToBasket = useMutation(api.basket.add);
  const removeFromBasket = useMutation(api.basket.remove).withOptimisticUpdate(removeFromBasketOptimistic);
  const updateBasketTitle = useMutation(api.basket.updateTitle);
  const { run, error } = useAsyncAction();

  const refresh = useCallback(async () => {
    setRecipes(await listRecipes());
  }, []);

  useEffect(() => {
    let active = true;
    listRecipes()
      .then((r) => active && setRecipes(r))
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [refreshKey]);

  async function onDelete(r: Recipe) {
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    await run(async () => {
      await deleteRecipe(r.id);
      await removeFromBasket({ recipeId: r.id }); // idempotent no-op if not in basket
      await refresh();
    });
  }

  async function onSaveEdit(title: string, ingredients: Ingredient[]) {
    if (!editing) return;
    const id = editing.id;
    const ok = await run(async () => {
      await updateRecipe(id, { title, ingredients });
      await updateBasketTitle({ recipeId: id, title }); // idempotent no-op if not in basket
      await refresh();
      return true;
    });
    if (ok) setEditing(null);
  }

  return (
    <div className="panel">
      <h2>Recipes</h2>
      {recipes.length === 0 && <p>No recipes yet.</p>}
      <ul>
        {recipes.map((r) => (
          <li key={r.id}>
            <span>{r.title}</span>
            <span>
              <button onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}>Add to basket</button>
              <button onClick={() => setEditing(r)}>Edit</button>
              <button onClick={() => onDelete(r)}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
      <ErrorText message={error} />
      {editing && (
        <RecipeEditDialog recipe={editing} onSave={onSaveEdit} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
```
(Note: `refresh` no longer self-catches — a refetch failure now surfaces through `run` instead of being swallowed. The initial-load `useEffect` keeps `console.error` since it's a passive, non-user-triggered fetch.)

- [ ] **Step 7: Build + full test gate**

Run:
```bash
cd /home/myoung/projects/pantry
pnpm --filter @pantry/web build
( cd apps/web && pnpm test )
```
Expected: `tsc -b` + `vite build` clean (confirms `.withOptimisticUpdate` typing, the `id: line._id` type, and the `gen.error ?? rm.error` usage). vitest green: existing 5 + Task 1's 5 + Task 2's 4 + GroceryList wiring 1 = 15 cases.

- [ ] **Step 8: Commit**

```bash
cd /home/myoung/projects/pantry
git add apps/web/src/components/GroceryList.tsx apps/web/src/components/GroceryList.test.tsx apps/web/src/components/Basket.tsx apps/web/src/components/RecipeForm.tsx apps/web/src/components/RecipeList.tsx
git commit -m "feat(web): optimistic toggle/remove + inline error surfacing across panels"
```

---

## Manual browser smoke (controller-run, after Task 3)

Not a task — the controller runs this against the live stack. No container rebuild needed (web-only; Vite HMR/`pnpm --filter @pantry/web dev`). Steps:
1. Toggle a grocery item's checkbox → it flips **instantly**, no revert-flicker.
2. Stop recipe-service (`docker compose stop recipe-service`) → click **Create recipe** / **Delete** / **Add to basket** → each shows an inline red error instead of failing silently. Restart it (`docker compose start recipe-service`) and confirm the error clears on the next successful action.
3. Remove a basket item → drops instantly; the Generate button does not flash "Generating…".

---

## Self-Review

**Spec coverage:**
- `useAsyncAction` hook (run/error/pending/clearError) + `errorMessage` → Task 1. ✓
- `ErrorText` + `.error` style → Task 1. ✓
- Optimistic `toggleItemOptimistic` + `removeFromBasketOptimistic` → Task 2. ✓
- Per-panel wiring (GroceryList, Basket, RecipeForm, RecipeList) → Task 3. ✓
- `basket.remove` optimistic wired at both call sites (Basket + RecipeList) → Task 3 Steps 4, 6. ✓
- jsdom + @testing-library/react infra + vitest config → Task 1 Steps 1-2. ✓
- Tests: errorMessage, hook (renderHook), optimistic updaters, one component wiring test → Tasks 1-3. ✓
- `basket.add` stays non-optimistic; no toasts/global context → respected (out of scope). ✓

**Placeholder scan:** complete code in every step; exact commands + expected counts. No TBDs.

**Type consistency:** `useAsyncAction().run` returns `Promise<T | undefined>`; success gated by truthy return (`created` = Recipe object; `ok` = `true`) consistently in RecipeForm/RecipeList. `toggleItemOptimistic`/`removeFromBasketOptimistic` signatures identical across `optimistic.ts`, its tests, and the `.withOptimisticUpdate(...)` call sites. `ErrorText({ message })` prop name identical at all four render sites. `id: line._id` is `Id<"groceryList">` matching `toggleItem`'s arg.

**Deviation from spec noted:** the spec's success-gate wording was `!== undefined`; the plan uses a **truthy-return** convention instead, because the edit-save/delete flows return void on success (so `undefined` can't distinguish success from failure) — the wrapped fn returns `true`/the created Recipe and callers check `if (await run(...))`. Functionally equivalent for the create case (Recipe is always truthy) and correct for the void cases.
