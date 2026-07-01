# Tailwind UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-CSS `apps/web` UI with a warm, modern design built on Tailwind v4 and a small set of owned UI primitives — no behavior, data, or wiring changes.

**Architecture:** Tailwind v4 (CSS-first, `@tailwindcss/vite` plugin) with a warm palette declared once in an `@theme` token block. A handful of local primitives (`Button`, `Card`, `Input`) styled with those tokens replace raw elements. The four panels + edit dialog are re-marked-up on the primitives inside a new app-shell header + responsive grid. Every handler, role, and test hook is preserved so the existing behavior suite stays green unchanged.

**Tech Stack:** React 19, Vite 8, TypeScript, Tailwind v4 (`@tailwindcss/vite`), vitest + jsdom + @testing-library/react.

## Global Constraints

- Web-only (`apps/web`); no backend / data / logic changes. Only markup, classes, and raw-element→primitive swaps.
- **Preserve every handler, prop, role, and test hook.** Existing tests (`GroceryList.test.tsx` → `getByRole("checkbox")` + `findByRole("alert")`; `useAsyncAction`, `optimistic`, `recipeService`) must pass UNCHANGED. If a swap breaks a query, fix the code — do not loosen the test.
- `ErrorText` keeps `role="alert"`. The grocery checkbox stays a native `<input type="checkbox">` with its strike-through-on-checked behavior. The edit dialog stays a native `<dialog>` with `showModal()`.
- **Tailwind v4**, CSS-first: no `tailwind.config.js`. Palette declared in an `@theme` block as `--color-<name>: <hex>;` (auto-generates `bg-<name>`/`text-<name>`/`border-<name>` utilities). Primitives reference token utilities (`bg-primary`, `text-danger`, `border-border`), never hard-coded hex.
- Palette (design intent): `--color-bg #faf7f2`, `--color-surface #ffffff`, `--color-border #e7e5e4`, `--color-primary #3f7d4e`, `--color-primary-hover #356b43`, `--color-danger #c0562f`, `--color-danger-hover #a8481f`, `--color-text #292524`, `--color-muted #78716c`.
- Radius: cards `rounded-xl`, controls `rounded-lg`. Shadow: `shadow-sm`. Light theme only (tokens allow later dark override).
- Tests import vitest globals explicitly (`import { describe, it, expect, vi } from "vitest"`); assert semantics/roles/`data-variant`, never Tailwind class strings.

---

## File Structure

```
apps/web/
  package.json                    # MODIFY: add devDeps tailwindcss, @tailwindcss/vite
  vite.config.ts                  # MODIFY: add tailwindcss() plugin
  src/
    index.css                     # CREATE: @import "tailwindcss" + @theme tokens + base body
    App.css                       # DELETE (replaced by index.css)
    main.tsx                      # MODIFY: import "./index.css" (was App.css)
    components/ui/
      Button.tsx                  # CREATE: variant/size button primitive
      Button.test.tsx             # CREATE
      Card.tsx                    # CREATE: panel shell
      Card.test.tsx               # CREATE
      Input.tsx                   # CREATE: styled input
    components/ErrorText.tsx      # MODIFY: Tailwind classes, keep role="alert"
    App.tsx                       # MODIFY: app-shell header + responsive grid
    components/RecipeForm.tsx     # MODIFY: Card + Input + Button
    components/RecipeList.tsx     # MODIFY: Card + Button variants
    components/Basket.tsx         # MODIFY: Card + Button variants
    components/GroceryList.tsx    # MODIFY: Card + styled checkbox rows
    components/RecipeEditDialog.tsx # MODIFY: styled modal card
```

---

## Task 1: Tailwind v4 setup + design tokens

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`
- Create: `apps/web/src/index.css`
- Delete: `apps/web/src/App.css`

**Interfaces:**
- Produces: a compiled Tailwind pipeline and the `@theme` color tokens (`--color-primary`, `--color-danger`, `--color-surface`, `--color-border`, `--color-text`, `--color-muted`, `--color-bg`, plus `-hover` variants) → the utilities `bg-primary`, `text-danger`, `border-border`, etc. that Tasks 2-3 consume.

- [ ] **Step 1: Add Tailwind v4 dev-dependencies**

Run (from repo root):
```bash
pnpm --filter @pantry/web add -D tailwindcss @tailwindcss/vite
```
Expected: `apps/web/package.json` gains both devDeps; lockfile updates.

- [ ] **Step 2: Register the Tailwind Vite plugin**

Replace `apps/web/vite.config.ts` with:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
  },
});
```

- [ ] **Step 3: Create the stylesheet with tokens**

Create `apps/web/src/index.css`:
```css
@import "tailwindcss";

@theme {
  --color-bg: #faf7f2;
  --color-surface: #ffffff;
  --color-border: #e7e5e4;
  --color-primary: #3f7d4e;
  --color-primary-hover: #356b43;
  --color-danger: #c0562f;
  --color-danger-hover: #a8481f;
  --color-text: #292524;
  --color-muted: #78716c;
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: system-ui, sans-serif;
  margin: 0;
}
```

- [ ] **Step 4: Point main.tsx at index.css and delete App.css**

In `apps/web/src/main.tsx`, change the stylesheet import:
```ts
import "./index.css";
```
(replacing `import "./App.css";`). Then delete the old file:
```bash
git rm apps/web/src/App.css
```

- [ ] **Step 5: Build + test gate**

Run:
```bash
cd /home/myoung/projects/pantry
pnpm --filter @pantry/web build
( cd apps/web && pnpm test )
```
Expected: `tsc -b` + `vite build` succeed (proves the Tailwind plugin compiles and generates the theme utilities); all 17 existing vitest cases still PASS under the added `tailwindcss()` plugin. (The panels look unstyled at this point — old class names are gone; Task 3 restyles them. That's an expected intermediate state; tests assert behavior, not appearance.)

- [ ] **Step 6: Commit**

```bash
cd /home/myoung/projects/pantry
git add apps/web/package.json pnpm-lock.yaml apps/web/vite.config.ts apps/web/src/index.css apps/web/src/main.tsx apps/web/src/App.css
git commit -m "feat(web): Tailwind v4 setup + warm design tokens"
```

---

## Task 2: UI primitives (Button, Card, Input) + ErrorText restyle

**Files:**
- Create: `apps/web/src/components/ui/Button.tsx`, `Button.test.tsx`, `apps/web/src/components/ui/Card.tsx`, `Card.test.tsx`, `apps/web/src/components/ui/Input.tsx`
- Modify: `apps/web/src/components/ErrorText.tsx`

**Interfaces:**
- Consumes: Tailwind token utilities from Task 1 (`bg-primary`, `text-danger`, `border-border`, …).
- Produces:
  - `Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" })` — renders `<button>` with `data-variant={variant}`, default `type="button"`, spreads native props.
  - `Card({ title?: string; children: React.ReactNode; className?: string })` — renders a `<section>` shell, `<h2>` when `title` set.
  - `Input(props: React.InputHTMLAttributes<HTMLInputElement>)` — renders a styled `<input>`, spreads native props.

- [ ] **Step 1: Write the failing Button test**

Create `apps/web/src/components/ui/Button.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("renders a <button> with its children", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("exposes the variant via data-variant (default primary)", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" }).getAttribute("data-variant")).toBe("danger");
    render(<Button>Plain</Button>);
    expect(screen.getByRole("button", { name: "Plain" }).getAttribute("data-variant")).toBe("primary");
  });

  it("forwards onClick and honors disabled", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("defaults to type=button and accepts type=submit", () => {
    const { rerender } = render(<Button>Default</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
    rerender(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm test src/components/ui/Button.test.tsx`
Expected: FAIL — `./Button` module not found.

- [ ] **Step 3: Implement Button**

Create `apps/web/src/components/ui/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed";

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border border-border bg-surface text-text hover:bg-border/40",
  ghost: "bg-transparent text-muted hover:bg-border/40 hover:text-text",
  danger: "bg-danger text-white hover:bg-danger-hover",
};

const sizeClasses: Record<Size, string> = {
  sm: "gap-1 px-2.5 py-1 text-sm",
  md: "gap-1.5 px-3.5 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      data-variant={variant}
      className={`${base} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && pnpm test src/components/ui/Button.test.tsx`
Expected: PASS (4 cases).

- [ ] **Step 5: Write the failing Card test**

Create `apps/web/src/components/ui/Card.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders its title as a heading and its children", () => {
    render(
      <Card title="Recipes">
        <p>hello</p>
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Recipes" })).toBeTruthy();
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("omits the heading when no title is given", () => {
    render(
      <Card>
        <p>body</p>
      </Card>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("body")).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `cd apps/web && pnpm test src/components/ui/Card.test.tsx`
Expected: FAIL — `./Card` module not found.

- [ ] **Step 7: Implement Card + Input**

Create `apps/web/src/components/ui/Card.tsx`:
```tsx
import type { ReactNode } from "react";

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-lg font-semibold text-text">{title}</h2>}
      {children}
    </section>
  );
}
```
Create `apps/web/src/components/ui/Input.tsx`:
```tsx
import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className}`}
      {...props}
    />
  );
}
```

- [ ] **Step 8: Run to verify Card passes**

Run: `cd apps/web && pnpm test src/components/ui/Card.test.tsx`
Expected: PASS (2 cases).

- [ ] **Step 9: Restyle ErrorText (keep role="alert")**

Replace `apps/web/src/components/ErrorText.tsx`:
```tsx
export function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p className="mt-2 text-sm text-danger" role="alert">
      {message}
    </p>
  ) : null;
}
```

- [ ] **Step 10: Build + full test gate**

Run:
```bash
cd /home/myoung/projects/pantry
pnpm --filter @pantry/web build
( cd apps/web && pnpm test )
```
Expected: build clean; vitest green — 17 existing + 4 Button + 2 Card = 23 cases. (`Input` has no dedicated test; it's a thin native-prop passthrough exercised by the panel restyle in Task 3 + the build's type check.)

- [ ] **Step 11: Commit**

```bash
cd /home/myoung/projects/pantry
git add apps/web/src/components/ui/Button.tsx apps/web/src/components/ui/Button.test.tsx apps/web/src/components/ui/Card.tsx apps/web/src/components/ui/Card.test.tsx apps/web/src/components/ui/Input.tsx apps/web/src/components/ErrorText.tsx
git commit -m "feat(web): Button/Card/Input primitives + ErrorText restyle"
```

---

## Task 3: App shell + panel restyle

**Files:**
- Modify: `apps/web/src/App.tsx`, `components/RecipeForm.tsx`, `components/RecipeList.tsx`, `components/Basket.tsx`, `components/GroceryList.tsx`, `components/RecipeEditDialog.tsx`

**Interfaces:**
- Consumes: `Button`, `Card`, `Input` (Task 2), `ErrorText` (Task 2); all existing hooks/handlers unchanged.
- Produces: the restyled UI (no new exported API).

- [ ] **Step 1: Restyle the app shell (App.tsx)**

Replace `apps/web/src/App.tsx`:
```tsx
import { useState } from "react";
import { RecipeForm } from "./components/RecipeForm";
import { RecipeList } from "./components/RecipeList";
import { Basket } from "./components/Basket";
import { GroceryList } from "./components/GroceryList";

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-4">
          <span className="text-2xl" aria-hidden>
            🥕
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-text">Pantry</h1>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <RecipeForm onCreated={() => setRefreshKey((k) => k + 1)} />
          <RecipeList refreshKey={refreshKey} />
          <Basket />
          <GroceryList />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Restyle RecipeForm**

Replace `apps/web/src/components/RecipeForm.tsx` (logic identical; only markup uses `Card`/`Input`/`Button`):
```tsx
import { useState } from "react";
import type { Ingredient } from "@pantry/types";
import { createRecipe } from "../lib/recipeService";
import { useAsyncAction } from "../lib/useAsyncAction";
import { ErrorText } from "./ErrorText";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";

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
    <Card title="New recipe">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex flex-col gap-2">
          {ingredients.map((ing, i) => (
            <div key={i} className="flex gap-2">
              <Input
                type="number"
                className="w-16"
                value={ing.quantity}
                onChange={(e) => update(i, { quantity: Number(e.target.value) })}
              />
              <Input
                placeholder="unit"
                className="w-24"
                value={ing.unit}
                onChange={(e) => update(i, { unit: e.target.value })}
              />
              <Input
                placeholder="item"
                className="flex-1"
                value={ing.item}
                onChange={(e) => update(i, { item: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setIngredients((p) => [...p, emptyIngredient()])}>
            + ingredient
          </Button>
          <Button type="submit" disabled={pending} className="ml-auto">
            {pending ? "Saving…" : "Create recipe"}
          </Button>
        </div>
        <ErrorText message={error} />
      </form>
    </Card>
  );
}
```

- [ ] **Step 3: Restyle RecipeList**

Replace `apps/web/src/components/RecipeList.tsx` (all hooks/handlers identical; markup uses `Card`/`Button`):
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
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

export function RecipeList({ refreshKey }: { refreshKey: number }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const addToBasket = useMutation(api.basket.add);
  const removeFromBasket = useMutation(api.basket.remove).withOptimisticUpdate(removeFromBasketOptimistic);
  const updateBasketTitle = useMutation(api.basket.updateTitle);
  const { run, error, clearError } = useAsyncAction();

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
    <Card title="Recipes">
      {recipes.length === 0 && <p className="text-sm text-muted">No recipes yet.</p>}
      <ul className="flex flex-col divide-y divide-border">
        {recipes.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            <span className="font-medium text-text">{r.title}</span>
            <span className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => run(() => addToBasket({ recipeId: r.id, title: r.title }))}>
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
      {editing && <RecipeEditDialog recipe={editing} onSave={onSaveEdit} onClose={() => setEditing(null)} />}
    </Card>
  );
}
```

- [ ] **Step 4: Restyle Basket**

Replace `apps/web/src/components/Basket.tsx`:
```tsx
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@pantry/convex/api";
import { useAsyncAction } from "../lib/useAsyncAction";
import { removeFromBasketOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

export function Basket() {
  const items = useQuery(api.basket.list) ?? [];
  const remove = useMutation(api.basket.remove).withOptimisticUpdate(removeFromBasketOptimistic);
  const generate = useAction(api.recipes.generateGroceryList);
  const gen = useAsyncAction();
  const rm = useAsyncAction();

  return (
    <Card title="Basket">
      {items.length === 0 && <p className="text-sm text-muted">Basket is empty.</p>}
      <ul className="flex flex-col divide-y divide-border">
        {items.map((b) => (
          <li key={b._id} className="flex items-center justify-between gap-2 py-2">
            <span className="text-text">{b.title}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                gen.clearError();
                rm.run(() => remove({ recipeId: b.recipeId }));
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <Button
        className="mt-3"
        onClick={() => {
          rm.clearError();
          gen.run(() => generate({}));
        }}
        disabled={gen.pending || items.length === 0}
      >
        {gen.pending ? "Generating…" : "Generate grocery list"}
      </Button>
      <ErrorText message={gen.error ?? rm.error} />
    </Card>
  );
}
```

- [ ] **Step 5: Restyle GroceryList (keep native checkbox + strike-through)**

Replace `apps/web/src/components/GroceryList.tsx`:
```tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "@pantry/convex/api";
import { useAsyncAction } from "../lib/useAsyncAction";
import { toggleItemOptimistic } from "../lib/optimistic";
import { ErrorText } from "./ErrorText";
import { Card } from "./ui/Card";

export function GroceryList() {
  const lines = useQuery(api.groceryList.getGroceryList) ?? [];
  const toggle = useMutation(api.groceryList.toggleItem).withOptimisticUpdate(toggleItemOptimistic);
  const { run, error } = useAsyncAction();

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
                className="h-4 w-4 accent-[--color-primary]"
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
      <ErrorText message={error} />
    </Card>
  );
}
```

- [ ] **Step 6: Restyle RecipeEditDialog (styled modal card)**

Replace `apps/web/src/components/RecipeEditDialog.tsx` (logic identical; `<dialog>` + `Input`/`Button`, styled backdrop):
```tsx
import { useEffect, useRef, useState } from "react";
import type { Recipe, Ingredient } from "@pantry/types";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";

const emptyIngredient = (): Ingredient => ({ quantity: 1, unit: "", item: "" });

export function RecipeEditDialog({
  recipe,
  onSave,
  onClose,
}: {
  recipe: Recipe;
  onSave: (title: string, ingredients: Ingredient[]) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(recipe.title);
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    recipe.ingredients.length ? recipe.ingredients : [emptyIngredient()],
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function update(i: number, patch: Partial<Ingredient>) {
    setIngredients((prev) => prev.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSave(
        title.trim(),
        ingredients.filter((ing) => ing.item.trim() !== ""),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
      className="m-auto w-full max-w-md rounded-xl border border-border bg-surface p-5 text-text shadow-lg backdrop:bg-black/40"
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Edit recipe</h2>
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex flex-col gap-2">
          {ingredients.map((ing, i) => (
            <div key={i} className="flex gap-2">
              <Input
                type="number"
                className="w-16"
                value={ing.quantity}
                onChange={(e) => update(i, { quantity: Number(e.target.value) })}
              />
              <Input
                placeholder="unit"
                className="w-24"
                value={ing.unit}
                onChange={(e) => update(i, { unit: e.target.value })}
              />
              <Input
                placeholder="item"
                className="flex-1"
                value={ing.item}
                onChange={(e) => update(i, { item: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => setIngredients((p) => [...p, emptyIngredient()])} className="mr-auto">
            + ingredient
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
```

- [ ] **Step 7: Build + full test gate**

Run:
```bash
cd /home/myoung/projects/pantry
pnpm --filter @pantry/web build
( cd apps/web && pnpm test )
```
Expected: `tsc -b` + `vite build` clean; all 23 vitest cases green. Critically, `GroceryList.test.tsx` (`getByRole("checkbox")` + `findByRole("alert")`) passes UNCHANGED — proving the restyle preserved the checkbox and error wiring.

- [ ] **Step 8: Commit**

```bash
cd /home/myoung/projects/pantry
git add apps/web/src/App.tsx apps/web/src/components/RecipeForm.tsx apps/web/src/components/RecipeList.tsx apps/web/src/components/Basket.tsx apps/web/src/components/GroceryList.tsx apps/web/src/components/RecipeEditDialog.tsx
git commit -m "feat(web): restyle panels + app shell on Tailwind primitives"
```

---

## Manual visual smoke (controller-run, after Task 3)

Not a task — the controller runs this against the live stack. Web-only, no container rebuild (Vite HMR / `pnpm --filter @pantry/web dev`). Check:
1. App renders the warm theme — cream page, herb-green primary buttons, terracotta Delete/Remove, white cards with soft shadow + rounded corners.
2. Header shows the 🥕 mark + "Pantry"; content is centered with a max width.
3. The grid is 2 columns on desktop and collapses to 1 column at a narrow (mobile) width.
4. Edit a recipe → the dialog is a centered modal card over a dimmed backdrop; Save/Cancel read clearly.
5. Toggle a grocery item, create/delete a recipe, generate a list — all still work (behavior unchanged), and errors still show inline.

---

## Self-Review

**Spec coverage:**
- Tailwind v4 setup (plugin, `@theme` tokens, index.css, delete App.css) → Task 1. ✓
- Warm palette tokens (bg/surface/border/primary/danger/text/muted + hover) → Task 1 Step 3. ✓
- UI primitives Button/Card/Input + ErrorText restyle → Task 2. ✓
- App shell header + responsive grid → Task 3 Step 1. ✓
- All panels + edit dialog restyled on primitives, behavior preserved → Task 3. ✓
- Existing tests green unchanged; primitive tests added → Tasks 1-3. ✓
- Light theme only; tokens allow later dark override → Task 1 Step 3. ✓

**Deviation from spec (intentional):** the spec Section 3 listed an `IconButton` primitive. Dropped — the restyle uses `Button variant="danger"/"ghost" size="sm"` for Delete/Remove and needs no icon-only control, so `IconButton` would be an unused primitive (YAGNI). No consumer, so it's omitted rather than built dead.

**Placeholder scan:** every step has complete file contents / exact commands + expected case counts. No TBDs.

**Type consistency:** `Button` props (`variant`/`size` + `ButtonHTMLAttributes`) identical across its definition, tests, and all call sites; `Card({title, children, className})` and `Input(InputHTMLAttributes)` identical across definition and consumers. Every restyled panel keeps the exact hooks/handlers/roles from the current code (verified against the current files): `run`/`error`/`pending`/`clearError` usage, `withOptimisticUpdate` wiring, `role="alert"` (ErrorText), native `checkbox`, native `<dialog>` + `showModal()`, and all button text labels ("Add to basket", "Edit", "Delete", "Remove", "Generate grocery list", "+ ingredient", "Save", "Cancel", "Create recipe"/"Saving…").
