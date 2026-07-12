# TanStack Router Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce file-based TanStack Router into `apps/web`, preserving the current single-page UI exactly.

**Architecture:** Add the TanStack Router Vite plugin (generates a typed route tree from `src/routes/`). Move the current header into a `__root.tsx` shell and the four-panel grid into an `index.tsx` route. Rewire `main.tsx` to render `RouterProvider` inside the existing `ConvexProvider`, and remove `App.tsx`.

**Tech Stack:** Vite 8, React 19, TypeScript, `@tanstack/react-router`, `@tanstack/router-plugin`, `@tanstack/react-router-devtools`, Convex, Tailwind v4.

## Global Constraints

- Package manager: **pnpm** (workspace). Run web commands with `pnpm --filter @pantry/web <script>`.
- The `tanstackRouter()` Vite plugin MUST be listed **before** `react()` in `vite.config.ts`.
- The generated `src/routeTree.gen.ts` is **gitignored** — never commit it.
- UI must render identically to today: header (🥕 Pantry) + a responsive grid of `RecipeForm`, `RecipeList`, `Basket`, `GroceryList`, with `RecipeList` refreshed via a `refreshKey` incremented on `RecipeForm`'s `onCreated`.
- Devtools must be dev-only (not rendered/bundled in production).

---

### Task 1: Install dependencies and configure the Vite plugin

Adds the router packages and wires the codegen plugin. Deliverable: `pnpm --filter @pantry/web dev` (or build) generates `src/routeTree.gen.ts`. No route files exist yet, so this task's verification is that the plugin loads and the dev server boots without config errors.

**Files:**
- Modify: `apps/web/package.json` (dependencies)
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/.gitignore`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the `tanstackRouter` Vite plugin active in the build; `src/routeTree.gen.ts` will be generated once route files exist (Task 2). `.gitignore` excludes `src/routeTree.gen.ts`.

- [ ] **Step 1: Install packages**

Run from repo root:
```bash
pnpm --filter @pantry/web add @tanstack/react-router
pnpm --filter @pantry/web add -D @tanstack/router-plugin @tanstack/react-router-devtools
```
Expected: `apps/web/package.json` gains `@tanstack/react-router` under `dependencies` and the other two under `devDependencies`; lockfile updates.

- [ ] **Step 2: Add the plugin to `vite.config.ts`**

Edit `apps/web/vite.config.ts` to import and register the plugin **before** `react()`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

- [ ] **Step 3: Gitignore the generated route tree**

Append to `apps/web/.gitignore`:
```
# TanStack Router generated route tree
src/routeTree.gen.ts
```

- [ ] **Step 4: Verify the plugin loads and generates the route tree**

The plugin only emits `routeTree.gen.ts` once a `src/routes/` dir with a root route exists. To verify the plugin itself is wired without error now, start the dev server briefly:
```bash
pnpm --filter @pantry/web dev &
sleep 6
```
Expected: dev server prints a Local URL with no plugin/config error. It may warn that no routes directory exists yet — that is expected at this task. Stop it:
```bash
kill %1 2>/dev/null
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/vite.config.ts apps/web/.gitignore pnpm-lock.yaml
git commit -m "build(web): add TanStack Router deps and Vite plugin"
```

---

### Task 2: Create the root shell and index route; rewire `main.tsx`

Moves the current UI into route files, wires the router, and removes `App.tsx`. Deliverable: the app renders identically at `/`, typecheck and existing tests pass. This is a single task because the route files, the router wiring, and the `App.tsx` removal are interdependent — the app does not compile in any intermediate state, so there is no meaningful independent review boundary between them.

**Files:**
- Create: `apps/web/src/routes/__root.tsx`
- Create: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/main.tsx`
- Delete: `apps/web/src/App.tsx`
- Generated (not committed): `apps/web/src/routeTree.gen.ts`

**Interfaces:**
- Consumes: the `tanstackRouter` plugin from Task 1 (generates `routeTree.gen.ts`).
- Produces:
  - `__root.tsx` exports `Route` via `createRootRoute({ component: RootLayout })`; renders the `🥕 Pantry` header, an `<Outlet />`, and dev-only `<TanStackRouterDevtools />`.
  - `index.tsx` exports `Route` via `createFileRoute("/")({ component: HomePage })`; renders the four-panel grid with local `refreshKey` state.
  - `main.tsx` constructs `const router = createRouter({ routeTree })` and augments `@tanstack/react-router`'s `Register` interface with `router: typeof router`.

- [ ] **Step 1: Create the root route (`src/routes/__root.tsx`)**

```tsx
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

function RootLayout() {
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
      <Outlet />
      {import.meta.env.DEV ? <TanStackRouterDevtools /> : null}
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
```

- [ ] **Step 2: Create the index route (`src/routes/index.tsx`)**

```tsx
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RecipeForm } from "../components/RecipeForm";
import { RecipeList } from "../components/RecipeList";
import { Basket } from "../components/Basket";
import { GroceryList } from "../components/GroceryList";

function HomePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <RecipeForm onCreated={() => setRefreshKey((k) => k + 1)} />
        <RecipeList refreshKey={refreshKey} />
        <Basket />
        <GroceryList />
      </div>
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: HomePage,
});
```

- [ ] **Step 3: Rewire `src/main.tsx`**

Replace the entire file with:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL ?? "http://127.0.0.1:3210";
const convex = new ConvexReactClient(convexUrl as string);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <RouterProvider router={router} />
    </ConvexProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 4: Delete `src/App.tsx`**

```bash
git rm apps/web/src/App.tsx
```
Expected: file removed. (Only `main.tsx` imported it, and Step 3 dropped that import.)

- [ ] **Step 5: Generate the route tree and typecheck**

The route tree is generated by the Vite plugin. Trigger generation, then typecheck:
```bash
pnpm --filter @pantry/web dev &
sleep 6
kill %1 2>/dev/null
ls apps/web/src/routeTree.gen.ts
pnpm --filter @pantry/web typecheck
```
Expected: `routeTree.gen.ts` exists; typecheck exits 0. If typecheck errors that `./routeTree.gen.ts` cannot be found, the dev server did not finish generating — re-run the dev/sleep/kill block once more before typechecking.

- [ ] **Step 6: Run existing tests**

```bash
pnpm --filter @pantry/web test
```
Expected: all existing tests pass (component tests render components directly and are unaffected by routing).

- [ ] **Step 7: Verify the app renders identically**

```bash
pnpm --filter @pantry/web dev &
sleep 6
```
Load the printed Local URL in a browser (or `curl -s <url> | grep -q 'id="root"'`). Confirm: header `🥕 Pantry` + the four-panel grid render, and creating a recipe via `RecipeForm` refreshes `RecipeList`. Then stop:
```bash
kill %1 2>/dev/null
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/__root.tsx apps/web/src/routes/index.tsx apps/web/src/main.tsx
git rm --cached apps/web/src/App.tsx 2>/dev/null; git add -u apps/web/src/App.tsx
git commit -m "feat(web): scaffold file-based TanStack Router; move App into routes"
```
Note: `routeTree.gen.ts` is gitignored and must NOT appear in the commit — verify with `git status` before committing.

---

## Self-Review

**Spec coverage:**
- Dependencies (`@tanstack/react-router`, `-devtools`, `-plugin`) → Task 1, Step 1. ✓
- Vite plugin before `react()` → Task 1, Step 2. ✓
- `__root.tsx` shell with header + `<Outlet/>` + dev-only devtools → Task 2, Step 1. ✓
- `index.tsx` with grid + `refreshKey` → Task 2, Step 2. ✓
- `main.tsx` rewired to `RouterProvider` inside `ConvexProvider` + `Register` augmentation → Task 2, Step 3. ✓
- `App.tsx` removed → Task 2, Step 4. ✓
- gitignore `routeTree.gen.ts` → Task 1, Step 3. ✓
- Verification (generate, typecheck, test, render) → Task 2, Steps 5–7. ✓
- Out of scope items (second route, nav, auth, loaders) → none added. ✓

**Placeholder scan:** No TBD/TODO/vague steps; all code blocks are complete. ✓

**Type consistency:** `Route` export name consistent across both route files; `createRouter({ routeTree })` consumes the generated `routeTree` export; `Register.router` matches `typeof router`. ✓
